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

app.post('/submit-score', (req, res) => {
    const { name, time, isMobile, startTime, endTime } = req.body;

    if (endTime - startTime !== time * 1000 || time <= 0) {
        return res.status(400).send("Ungültige Zeit");
    }

    const db = isMobile ? dbMobile : dbDesktop;
    db.get("SELECT time FROM leaderboard WHERE name = ?", [name], (err, row) => {
        if (err) {
            return res.status(500).send("Fehler beim Abrufen des Punktestands");
        }
        if (row) {
            if (time < row.time) {
                const stmt = db.prepare("UPDATE leaderboard SET time = ? WHERE name = ?");
                stmt.run(time, name, function(err) {
                    if (err) {
                        return res.status(500).send("Fehler beim Aktualisieren des Punktestands");
                    }
                    finalizeLeaderboard(db, isMobile, res);
                });
                stmt.finalize();
            } else {
                return res.status(400).send("Neuer Punktestand ist nicht besser als der bisherige");
            }
        } else {
            const stmt = db.prepare("INSERT INTO leaderboard (name, time) VALUES (?, ?)");
            stmt.run(name, time, function(err) {
                if (err) {
                    return res.status(500).send("Fehler beim Speichern des Punktestands");
                }
                finalizeLeaderboard(db, isMobile, res);
            });
            stmt.finalize();
        }
    });
});

function finalizeLeaderboard(db, isMobile, res) {
    db.run("DELETE FROM leaderboard WHERE rowid NOT IN (SELECT rowid FROM leaderboard ORDER BY time ASC LIMIT 10)", function(err) {
        if (err) {
            return res.status(500).send("Fehler beim Bereinigen des Leaderboards");
        }
        io.emit('update-leaderboard');
        res.send("Punktestand gespeichert");
    });
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