document.addEventListener("DOMContentLoaded", () => {
    let userSequence = [];
    let puzzleSolved = false;
    let isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    let timerStarted = false;
    let sequenceLocked = false;
    let mode = 4;

    const socket = io();
    const toggleButton = document.getElementById('darkModeToggle');

    window.onload = function() {
        showLeaderboards();
        showTries();
        document.querySelectorAll('.tab-item').forEach(item => {
            item.addEventListener('click', changeMode);
        });
        toggleButton.addEventListener("change", toggleDarkMode);
        document.getElementById('submit-button').addEventListener('click', submitScore);
        document.getElementById('continue-button').addEventListener('click', () => {
            window.location.href = "content.html";
        });
        document.getElementById('reset-button').addEventListener('click', reset);
        if (isMobile) {
            document.getElementById('reset-button').classList.remove('hidden');
        }
        const mode = localStorage.getItem('selectedMode') || '4';
        initializeGame(mode);
        document.querySelectorAll('.grid-item').forEach(item => {
            item.addEventListener('click', selectItem);
        });
    };

    socket.on('update-leaderboard', showLeaderboards);
    socket.on('update-tries', showTries);
    socket.on('start-puzzle', () => {});
    socket.on('puzzle-solved', displayPuzzleSolved);
    socket.on('score-submitted', displayScoreSubmitted);
    socket.on('new-sequence', () => {});
    socket.on('cheater', displayCheaterMessage);

    function startPuzzle() {
        socket.emit('start-puzzle');
    }

    function check(number, index) {
        return new Promise((resolve, reject) => {
            socket.emit('check-tile', {number, index});
            
            socket.once('tile-response', (response) => {
                resolve(response);
            });
    
            const timeoutId = setTimeout(() => {
                reject(new Error('Request timed out'));
            }, 5000);
    
            socket.on('error', (error) => {
                clearTimeout(timeoutId);  
                reject(error);
            });
        });
    }
    
    async function selectItem(event) {
        if (puzzleSolved) return;
        if (!timerStarted) {
            document.querySelectorAll('.tab-item').forEach(item => {
                item.removeEventListener('click', changeMode);
            });
            timerStarted = true;
            sequenceLocked = true;
            startPuzzle(new Date().getTime());
        }
    
        const gridItem = event.target;
        const number = gridItem.getAttribute('data-number');

        try {
            const isCorrect = await check(number, userSequence.length);
            if (isCorrect) {
                gridItem.classList.add('correct');
                userSequence.push(number);
                if (userSequence.length == mode) {
                    puzzleSolved = true;
                    document.getElementById('reset-button').classList.add('hidden');
                    socket.emit('end-puzzle', {userSequence});
                }
            } else {
                gridItem.classList.add('incorrect');
                setTimeout(() => {
                    document.getElementById('message').innerText = "Wrong sequence. Please try again.";
                    resetPuzzle();
                }, 80);
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }

    function resetPuzzle() {
        userSequence = [];
        document.querySelectorAll('.grid-item').forEach(item => {
            item.classList.remove('correct', 'incorrect');
        });
        puzzleSolved = false;
    }

    async function changeMode(event) {
        if (sequenceLocked) return;

        const tab = event.target;
        const mode = tab.getAttribute('data-mode');
        if (mode == localStorage.getItem('selectedMode')) return;

        newSequence(mode);
        localStorage.setItem('selectedMode', mode);
        showLeaderboards();
        document.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
        tab.classList.add('active');
    }

    function initializeGame(mode) {
        newSequence(mode);
        document.querySelector(`.tab-item[data-mode="${mode}"]`).classList.add('active');
    }

    function displayPuzzleSolved(timeTaken) {
        document.getElementById('input-section').classList.remove('hidden');
        document.getElementById('message').innerText = `You did it in: ${timeTaken} seconds. Please enter your name.`;
    }

    function submitScore() {
        const name = document.getElementById('name').value;
        if (!name) {
            document.getElementById('message').innerText = "Please enter your name.";
            return;
        }
        socket.emit('submit-score', { name, isMobile });
    }

    function displayScoreSubmitted(message) {
        document.getElementById('message').innerText = message;
        document.getElementById('continue-section').classList.remove('hidden');
        document.getElementById('input-section').classList.add('hidden');
    }

    async function showLeaderboards() {
        fetchLeaderboard(isMobile, 'leaderboard-list', 'leaderboard-title');
        fetchLeaderboard(!isMobile, 'other-leaderboard-list', 'other-leaderboard-title');
    }

    function fetchLeaderboard(isMobile, listId, titleId) {
        fetch(`/leaderboard?isMobile=${isMobile}&mode=${localStorage.getItem('selectedMode') || '4'}`)
            .then(response => response.json())
            .then(data => {
                const leaderboardList = document.getElementById(listId);
                const leaderboardTitle = document.getElementById(titleId);
                leaderboardTitle.textContent = isMobile ? "Mobile Leaderboard" : "Desktop Leaderboard";
                leaderboardList.innerHTML = '';
                data.forEach((entry, index) => {
                    const listItem = document.createElement('li');
                    listItem.textContent = `${index + 1}. ${entry.name}: ${entry.time} Seconds`;
                    leaderboardList.appendChild(listItem);
                });
            });
    }

    function showTries() {
        fetch('/tries')
            .then(response => response.json())
            .then(data => {
                document.getElementById('tries').innerText = `${data.tries}`;
            })
            .catch((error) => {
                console.error('Error:', error);
            });
    }

    function newSequence(length) {
        socket.emit('new-sequence', length);
    }

    function reset() {
        if (!sequenceLocked || !timerStarted) return;
        userSequence = [];
        socket.emit('end-puzzle', { userSequence });
        sequenceLocked = false;
        timerStarted = false;
        document.querySelectorAll('.tab-item').forEach(item => {
            item.addEventListener('click', changeMode);
        });
        newSequence(localStorage.getItem('selectedMode') || '4');
        resetPuzzle();
        document.getElementById('message').innerText = "reset successful";
    }

    function toggleDarkMode() {
        if (toggleButton.checked) {
            disableLightMode();
        } else {
            enableLightMode();
        }
    }

    if (localStorage.getItem("darkMode") === "disabled") {
        toggleButton.checked = false;
        enableLightMode();
    } else {
        toggleButton.checked = true;
    }

    function enableLightMode() {
        document.body.classList.add("light-mode");
        document.querySelectorAll('.container, .leaderboard-container, .button, .grid-item, .tries-container, .tab-item, .tab-item.active').forEach(el => {
            el.classList.add('light-mode');
        });
        localStorage.setItem("darkMode", "disabled");
    }

    function disableLightMode() {
        document.body.classList.remove("light-mode");
        document.querySelectorAll('.container, .leaderboard-container, .button, .grid-item, .tries-container, .tab-item, .tab-item.active').forEach(el => {
            el.classList.remove('light-mode');
        });
        localStorage.setItem("darkMode", "enabled");
    }

    function displayCheaterMessage() {
        document.body.innerHTML = '<div style="color: red; font-size: 48px; text-align: center; margin-top: 20%;">Cheater</div>';
    }
});
