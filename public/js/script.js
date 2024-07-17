document.addEventListener("DOMContentLoaded", () => {
    let correctSequence = [];
    let userSequence = [];
    let puzzleSolved = false;
    let salt = '';
    let isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    let timerStarted = false;
    let sequenceLocked = false;

    const socket = io();

    socket.on('update-leaderboard', showLeaderboards);

    socket.on('update-tries',()=> {
        showTries();
    });

    socket.on('start-puzzle', () => {
        
    });

    function startPuzzle() {
        socket.emit('start-puzzle');
    }

    async function selectItem(event) {
        if (puzzleSolved) return;
        if (!timerStarted) {
            document.querySelectorAll('.tab-item').forEach(item => {
                item.removeEventListener('click', changeMode);
            });
            timerStarted = true;
            sequenceLocked = true;
            startPuzzle();
        }

        const gridItem = event.target;
        const number = gridItem.getAttribute('data-number');
        hashNum(number.toString(), salt).then(hashedNumber => {
            if (correctSequence[userSequence.length] === hashedNumber) {
                gridItem.classList.add('correct');
                userSequence.push(number);
                if (userSequence.length === correctSequence.length) {
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
        });
    }

    function resetPuzzle() {
        userSequence = [];
        document.querySelectorAll('.grid-item').forEach(item => {
            item.classList.remove('correct', 'incorrect');
        });
        puzzleSolved = false;
    }

    async function changeMode(event) {
        if (sequenceLocked) {
            return;
        }
        const tab = event.target;
        const mode = tab.getAttribute('data-mode');
        if(mode == localStorage.getItem('selectedMode')){
            return
        }
        getSequence(mode);
        localStorage.setItem('selectedMode', mode);
        showLeaderboards();
        document.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
        tab.classList.add('active');
    }
    
    function initializeGame(mode) {
        getSequence(mode);
        document.querySelector(`.tab-item[data-mode="${mode}"]`).classList.add('active');
    }

    socket.on('puzzle-solved', (timeTaken) => {
        document.getElementById('input-section').classList.remove('hidden');
        document.getElementById('message').innerText = `You did it in: ${timeTaken} seconds. Please enter your name.`;
    });

    document.getElementById('submit-button').addEventListener('click', () => {
        const name = document.getElementById('name').value;
        if (!name) {
            document.getElementById('message').innerText = "Please enter your name.";
            return;
        }

        socket.emit('submit-score', { name, isMobile });
    });

    socket.on('score-submitted', (message) => {
        document.getElementById('message').innerText = message;
        document.getElementById('continue-section').classList.remove('hidden');
        document.getElementById('input-section').classList.add('hidden'); 
    });

    async function showLeaderboards() {
        fetch(`/leaderboard?isMobile=${isMobile}&mode=${localStorage.getItem('selectedMode') || '4'}`)
            .then(response => response.json())
            .then(data => {
                const leaderboardList = document.getElementById('leaderboard-list');
                const leaderboardTitle = document.getElementById('leaderboard-title');
                leaderboardTitle.textContent = isMobile ? "Mobile Leaderboard" : "Desktop Leaderboard";
                leaderboardList.innerHTML = '';
                data.forEach((entry, index) => {
                    const listItem = document.createElement('li');
                    listItem.textContent = `${index + 1}. ${entry.name}: ${entry.time} Seconds`;
                    leaderboardList.appendChild(listItem);
                });
            });

        fetch(`/leaderboard?isMobile=${!isMobile}&mode=${localStorage.getItem('selectedMode') || '4'}`)
            .then(response => response.json())
            .then(data => {
                const otherLeaderboardList = document.getElementById('other-leaderboard-list');
                const otherLeaderboardTitle = document.getElementById('other-leaderboard-title');
                otherLeaderboardTitle.textContent = !isMobile ? "Mobile Leaderboard" : "Desktop Leaderboard";
                otherLeaderboardList.innerHTML = '';
                data.forEach((entry, index) => {
                    const listItem = document.createElement('li');
                    listItem.textContent = `${index + 1}. ${entry.name}: ${entry.time} Seconds`;
                    otherLeaderboardList.appendChild(listItem);
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

    document.getElementById('continue-button').addEventListener('click', () => {
        window.location.href = "content.html";
    });

    function getSequence(length) {
        socket.emit('get-sequence', (length));
    }

    socket.on('get-sequence', ({ hashedSequence, salt: receivedSalt }) => {
        correctSequence = hashedSequence;
        salt = receivedSalt;
    });

    function reset(){
        if(!sequenceLocked || !timerStarted){
            return;
        }
        userSequence = [];
        socket.emit('end-puzzle', {userSequence});
        sequenceLocked = false;
        timerStarted = false;
        document.querySelectorAll('.tab-item').forEach(item => {
            item.addEventListener('click', changeMode);
        });
        getSequence(localStorage.getItem('selectedMode') || '4');
        resetPuzzle();
        document.getElementById('message').innerText = "reset sucessfull";
    }

    window.onload = function() {
        showLeaderboards();
        showTries();
        document.querySelectorAll('.grid-item').forEach(item => {
            item.addEventListener('click', selectItem);
        });
        document.querySelectorAll('.tab-item').forEach(item => {
            item.addEventListener('click', changeMode);
        });
        document.getElementById('reset-button').addEventListener('click', reset);
        if(isMobile){
            document.getElementById('reset-button').classList.remove('hidden');
        }
        const savedMode = localStorage.getItem('selectedMode') || '4';
        initializeGame(savedMode);
    };

    async function hashNum(input, salt) {
        const encoder = new TextEncoder();
        const data = encoder.encode(input + salt);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const toggleButton = document.getElementById('darkModeToggle');

    if (localStorage.getItem("darkMode") === "disabled") {
        toggleButton.checked = false;
        enableLightMode();
    } else {
        toggleButton.checked = true;
    }

    toggleButton.addEventListener("change", () => {
        if (toggleButton.checked) {
            disableLightMode();
        } else {
            enableLightMode();
        }
    });

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

    socket.on('cheater', () => {
        document.body.innerHTML = '<div style="color: red; font-size: 48px; text-align: center; margin-top: 20%;">Cheater</div>';
    });
});