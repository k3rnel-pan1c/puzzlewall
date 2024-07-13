const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbMobile = new sqlite3.Database('leaderboard_mobile.db');
const dbDesktop = new sqlite3.Database('leaderboard_desktop.db');

dbMobile.serialize(() => {
    dbMobile.run("CREATE TABLE IF NOT EXISTS leaderboard (name TEXT UNIQUE, time REAL)");
});

dbDesktop.serialize(() => {
    dbDesktop.run("CREATE TABLE IF NOT EXISTS leaderboard (name TEXT UNIQUE, time REAL)");
});

let sequences = {};
let startTimes = {};

io.on('connection', (socket) => {
    socket.on('start-puzzle', () => {
        const sequence = generateSequence();
        sequences[socket.id] = sequence;
        startTimes[socket.id] = new Date().getTime();
        socket.emit('start-puzzle', sequence);
    });

    socket.on('end-puzzle', (userSequence) => {
        const endTime = new Date().getTime();
        const correctSequence = sequences[socket.id];
        if (JSON.stringify(correctSequence) === JSON.stringify(userSequence)) {
            const timeTaken = (endTime - startTimes[socket.id]) / 1000;
            socket.emit('puzzle-solved', timeTaken);
        } else {
            socket.emit('puzzle-failed');
        }
    });

    socket.on('submit-score', ({ name, isMobile }) => {
        const endTime = new Date().getTime();
        const timeTaken = (endTime - startTimes[socket.id]) / 1000;
        const db = isMobile ? dbMobile : dbDesktop;

        db.get("SELECT time FROM leaderboard WHERE name = ?", [name], (err, row) => {
            if (err) {
                socket.emit('score-submitted', "Fehler beim Abrufen des Punktestands");
                return;
            }
            if (row) {
                if (timeTaken < row.time) {
                    const stmt = db.prepare("UPDATE leaderboard SET time = ? WHERE name = ?");
                    stmt.run(timeTaken, name, function(err) {
                        if (err) {
                            socket.emit('score-submitted', "Fehler beim Aktualisieren des Punktestands");
                            return;
                        }
                        finalizeLeaderboard(db, isMobile, () => {
                            socket.emit('score-submitted', "Punktestand gespeichert");
                            io.emit('update-leaderboard');
                        });
                    });
                    stmt.finalize();
                } else {
                    socket.emit('score-submitted', "Neuer Punktestand ist nicht besser als der bisherige");
                }
            } else {
                const stmt = db.prepare("INSERT INTO leaderboard (name, time) VALUES (?, ?)");
                stmt.run(name, timeTaken, function(err) {
                    if (err) {
                        socket.emit('score-submitted', "Fehler beim Speichern des Punktestands");
                        return;
                    }
                    finalizeLeaderboard(db, isMobile, () => {
                        socket.emit('score-submitted', "Punktestand gespeichert");
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
            console.error("Fehler beim Bereinigen des Leaderboards:", err);
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

app.get('/leaderboard', (req, res) => {
    const isMobile = req.query.isMobile === 'true';
    const db = isMobile ? dbMobile : dbDesktop;
    db.all("SELECT name, time FROM leaderboard ORDER BY time ASC LIMIT 10", [], (err, rows) => {
        if (err) {
            return res.status(500).send("Fehler beim Abrufen des Leaderboards");
        }
        res.json(rows);
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'puzzlewall.html'));
});

server.listen(80, () => {
    console.log('Server läuft auf http://localhost:80');
});
