const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

const generateNonce = () => {
    return crypto.randomBytes(16).toString('base64');
};

app.use((req, res, next) => {
    const nonce = generateNonce();
    res.locals.nonce = nonce;
    res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self';`);
    next();
});

app.use(bodyParser.json());

const dbMobile = new sqlite3.Database('leaderboard_mobile.db');
const dbDesktop = new sqlite3.Database('leaderboard_desktop.db');
const dbTries = new sqlite3.Database('tries.db');

dbMobile.serialize(() => {
    dbMobile.run("CREATE TABLE IF NOT EXISTS leaderboard (name TEXT UNIQUE, time REAL)");
});

dbDesktop.serialize(() => {
    dbDesktop.run("CREATE TABLE IF NOT EXISTS leaderboard (name TEXT UNIQUE, time REAL)");
});

dbTries.serialize(() => {
    dbTries.run("CREATE TABLE IF NOT EXISTS tries (tries INTEGER)");
    dbTries.run("INSERT OR IGNORE INTO tries (rowid, tries) VALUES (1, 0)");
});

let sequences = {};
let startTimes = {};
let endTimes = {};

io.on('connection', (socket) => {
    socket.on('start-puzzle', () => {
        startTimes[socket.id] = new Date().getTime();
        const stmt = dbTries.prepare("UPDATE tries SET tries = tries + 1 WHERE rowid = 1");
        stmt.run(function(err) {
            if (err) {
                socket.emit('score-submitted', "Error while trying to update trycount");
                return;
            }
            dbTries.get("SELECT tries FROM tries WHERE rowid = 1", (err, row) => {
                if (err) {
                    socket.emit('score-submitted', "error while fetching trycount");
                    return;
                }
                io.emit('update-tries', row.tries);
            });
        });
        stmt.finalize();
        socket.emit('start-puzzle');
    });

    socket.on('get-sequence', () => {
        const sequence = generateSequence();
        sequences[socket.id] = sequence.map(num => hashNum(num.toString()));
        startTimes[socket.id] = new Date().getTime();
        socket.emit('get-sequence', sequences[socket.id]);
    });

    socket.on('end-puzzle', (userSequence) => {
        endTimes[socket.id] = new Date().getTime();
        const correctSequence = sequences[socket.id];
        const hashedUserSequence = userSequence.map(num => hashNum(num.toString()));
        if (JSON.stringify(correctSequence) === JSON.stringify(hashedUserSequence)) {
            const timeTaken = (endTimes[socket.id] - startTimes[socket.id]) / 1000;
            socket.emit('puzzle-solved', timeTaken);
        } else {
            socket.emit('puzzle-failed');
        }
    });

    socket.on('submit-score', ({ name, isMobile }) => {
        if(endTimes[socket.id] == null){
            socket.emit('cheater');
            return;
        }
        const timeTaken = (endTimes[socket.id] - startTimes[socket.id]) / 1000;
        if (timeTaken == null) {
            socket.emit('cheater');
            return;
        }        
        const db = isMobile ? dbMobile : dbDesktop;

        db.get("SELECT time FROM leaderboard WHERE name = ?", [name], (err, row) => {
            if (err) {
                socket.emit('score-submitted', "error while fetching time");
                return;
            }
            if (row) {
                if (timeTaken < row.time) {
                    const stmt = db.prepare("UPDATE leaderboard SET time = ? WHERE name = ?");
                    stmt.run(timeTaken, name, function(err) {
                        if (err) {
                            socket.emit('score-submitted', "error while updating time");
                            return;
                        }
                        finalizeLeaderboard(db, isMobile, () => {
                            socket.emit('score-submitted', "time saved");
                            io.emit('update-leaderboard');
                        });
                    });
                    stmt.finalize();
                } else {
                    socket.emit('score-submitted', "new time is not better than the old one for that name");
                }
            } else {
                const stmt = db.prepare("INSERT INTO leaderboard (name, time) VALUES (?, ?)");
                stmt.run(name, timeTaken, function(err) {
                    if (err) {
                        socket.emit('score-submitted', "error while saving time");
                        return;
                    }
                    finalizeLeaderboard(db, isMobile, () => {
                        socket.emit('score-submitted', "time saved");
                        io.emit('update-leaderboard');
                    });
                });
                stmt.finalize();
            }
        });
    });
});

function finalizeLeaderboard(db, isMobile, callback) {
    db.run("DELETE FROM leaderboard WHERE rowid NOT IN (SELECT rowid FROM leaderboard ORDER BY time ASC LIMIT 10)", function(err) {
        if (err) {
            console.error("error while finalizing leaderboard:", err);
            return;
        }
        callback();
    });
}

function generateSequence() {
    const sequence = [];
    while (sequence.length < 4) {
        const num = Math.floor(Math.random() * 9) + 1;
        if (!sequence.includes(num)) {
            sequence.push(num);
        }
    }
    return sequence;
}

function hashNum(input) {
    return crypto.createHash('sha256').update(input.toString()).digest('hex');
}

app.get('/leaderboard', (req, res) => {
    const isMobile = req.query.isMobile === 'true';
    const db = isMobile ? dbMobile : dbDesktop;
    db.all("SELECT name, time FROM leaderboard ORDER BY time ASC LIMIT 10", [], (err, rows) => {
        if (err) {
            return res.status(500).send("error while fetching leaderboard");
        }
        res.json(rows);
    });
});

app.get('/tries', (req, res) => {
    dbTries.get("SELECT tries FROM tries WHERE rowid = 1", (err, row) => {
        if (err) {
            return res.status(500).send("error while fetching trycount");
        }
        res.json(row);
    });
});

app.get('/', (req, res) => {
    res.render('index', { nonce: res.locals.nonce });
});

server.listen(80, () => {
    console.log('Server läuft auf http://localhost:80');
});
