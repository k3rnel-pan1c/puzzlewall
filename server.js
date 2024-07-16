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

const db = new sqlite3.Database('puzzlewall.db');

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS leaderboard_desktop_4 (name TEXT UNIQUE, time REAL)");
    db.run("CREATE TABLE IF NOT EXISTS leaderboard_desktop_6 (name TEXT UNIQUE, time REAL)");
    db.run("CREATE TABLE IF NOT EXISTS leaderboard_desktop_8 (name TEXT UNIQUE, time REAL)");
    db.run("CREATE TABLE IF NOT EXISTS leaderboard_mobile_4 (name TEXT UNIQUE, time REAL)");
    db.run("CREATE TABLE IF NOT EXISTS leaderboard_mobile_6 (name TEXT UNIQUE, time REAL)");
    db.run("CREATE TABLE IF NOT EXISTS leaderboard_mobile_8 (name TEXT UNIQUE, time REAL)");
    db.run("CREATE TABLE IF NOT EXISTS tries (tries INTEGER)");
    db.run("INSERT OR IGNORE INTO tries (rowid, tries) VALUES (1, 0)");
});

let sequences = {};
let startTimes = {};
let endTimes = {};
let modes = {};
let salts = {};

io.on('connection', (socket) => {
    socket.on('start-puzzle', () => {
        startTimes[socket.id] = new Date().getTime();
        const stmt = db.prepare("UPDATE tries SET tries = tries + 1 WHERE rowid = 1");
        stmt.run(function(err) {
            if (err) {
                socket.emit('score-submitted', "Error while trying to update trycount");
                return;
            }
            db.get("SELECT tries FROM tries WHERE rowid = 1", (err, row) => {
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

    socket.on('get-sequence', (length) => {
        const sequence = generateSequence(length);
        const salt = generateSalt();
        salts[socket.id] = salt;
        sequences[socket.id] = sequence.map(num => hashNum(num.toString(), salt));
        startTimes[socket.id] = new Date().getTime();
        modes[socket.id] = length;
        socket.emit('get-sequence', { hashedSequence: sequences[socket.id], salt: salt });
    });

    socket.on('end-puzzle', ({ userSequence}) => {
        endTimes[socket.id] = new Date().getTime();
        const salt = salts[socket.id];
        const correctSequence = sequences[socket.id];
        const hashedUserSequence = userSequence.map(num => hashNum(num.toString(), salt));
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
        const mode = modes[socket.id];
        const device = isMobile ? "mobile" : "desktop";
        const table = "leaderboard_" + device +"_" + mode;

        db.get("SELECT time FROM " + table + " WHERE name = ?", [name], (err, row) => {
            if (err) {
                socket.emit('score-submitted', "error while fetching time");
                return;
            }
            if (row) {
                if (timeTaken < row.time) {
                    const stmt = db.prepare("UPDATE " + table + " SET time = ? WHERE name = ?");
                    stmt.run(timeTaken, name, function(err) {
                        if (err) {
                            socket.emit('score-submitted', "error while updating time");
                            return;
                        }
                        finalizeLeaderboard(table, () => {
                            socket.emit('score-submitted', "time saved");
                            io.emit('update-leaderboard');
                        });
                    });
                    stmt.finalize();
                } else {
                    socket.emit('score-submitted', "new time is not better than the old one for that name");
                }
            } else {
                const stmt = db.prepare("INSERT INTO " + table + " (name, time) VALUES (?, ?)");
                stmt.run(name, timeTaken, function(err) {
                    if (err) {
                        socket.emit('score-submitted', "error while saving time");
                        return;
                    }
                    finalizeLeaderboard(table, () => {
                        socket.emit('score-submitted', "time saved");
                        io.emit('update-leaderboard');
                    });
                });
                stmt.finalize();
            }
        });
    });
});

function finalizeLeaderboard(table, callback) {
    db.run("DELETE FROM " + table + " WHERE rowid NOT IN (SELECT rowid FROM " + table + " ORDER BY time ASC LIMIT 10)", function(err) {
        if (err) {
            console.error("error while finalizing leaderboard:", err);
            return;
        }
        callback();
    });
}

function generateSequence(length) {
    const sequence = [];
    while (sequence.length < length) {
        const num = Math.floor(Math.random() * 9) + 1;
        if (!sequence.includes(num)) {
            sequence.push(num);
        }
    }
    return sequence;
}

function hashNum(input, salt) {
    return crypto.createHash('sha256').update(input.toString() + salt).digest('hex');
}

function generateSalt() {
    return crypto.randomBytes(16).toString('base64');
}

app.get('/leaderboard', (req, res) => {
    const isMobile = req.query.isMobile === 'true';
    const mode = req.query.mode;
    const device = isMobile ? "mobile" : "desktop";
    const table = "leaderboard_" + device +"_" + mode;
    db.all("SELECT name, time FROM " + table + " ORDER BY time ASC LIMIT 10", [], (err, rows) => {
        if (err) {
            return res.status(500).send("error while fetching leaderboard");
        }
        res.json(rows);
    });
});

app.get('/tries', (req, res) => {
    db.get("SELECT tries FROM tries WHERE rowid = 1", (err, row) => {
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
