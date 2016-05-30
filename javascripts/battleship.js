/*

Inspiration: http://www.datagenetics.com/blog/december32011/

The article above recommends employing a suite of algorithms to win a game of Battleship in the fewest moves. One of these is an algorithm that selects targets based on the probability of a point on the grid being occupied. I was curious how effective an AI opponent would be if it used ONLY this algorithm.

Result: The average win occurs after 62 moves. 

I then attempted to skew the probability on positions adjacent to hits so the AI would focus on areas known to contain a ship. No additional logic was used to take advantage of, for example, two adjacent hits indicating a ship's alignment.

Result: The average win occurs after 55 moves.

I forked http://jsfiddle.net/FgbAK/ and then attempted to detect sunken ships so the AI would no longer focus on areas known to contain a sunken ship.  This had the side effect of greatly decreasing the runtime, so I also fixed the runs at 1000

Result: The average win occurs after 51 moves (10,000 runs)

I then increased the skew factor for areas surrounding hits, because the original Data Genetics article states "a _heavy_ score weighting"

Result: The average win occurs after 48 moves (10,000 runs)

I then treated SUNK the same as MISS in the ship placement detection code

Result: The average win occurs after 46.2073 moves (10,000 runs)

I then took sunk ships into account when calculating probabilities (instead of always including all 5 ships)

Result: The average win occurs after 45.9515 moves (10,000 runs)

I then optimized a few things to reduce the time to simulate a game, making it much more bearable to run 10,000 simulations at a time.  Part of this was to remove the "store uniques to avoid skewing positions multiple times", which did not seem to positively or negatively affect the average win score

Result: The average win occurs after 45.9539 moves (10,000 runs)

I then guessed ship orientation when there are two (or more) adjacent hits

Result: The average win occurs after 44.94417 moves (bumped up to 100,000 runs)

TODO: When random firing, take neighbours into account as per http://arnosoftwaredev.blogspot.ca/2008/06/battleship-game-algorithm-explained_19.html and  http://arnosoftwaredev.blogspot.ca/2008/07/battleship-game-algorithm-explained.html
*/

(function (document) {
    'use strict';

    var UNKNOWN = 0,
        SHIP = 1,
        MISS = 2,
        HIT = 3,
        SUNK = 4,
        hitsMade,
        hitsToWin,
        ships = [5, 4, 3, 3, 2],
        shipPositions = [],
        // TODO: look into Int8Array on these big matrices for performance
        boardSize = 10,
        positions = new Array(boardSize),
        probabilities = new Array(boardSize),
        hitsSkewProbabilities = true,
        skewFactor = 10,
        classMapping = ['unknown', 'ship', 'miss', 'hit', 'sunk'],
        board,
        resultMsg,
        volleyButton,
        monteCarloCheckbox,
        monteCarlo = false;

    // run immediately
    initialize();

    function initialize() {
        board = document.getElementById('board');
        resultMsg = document.getElementById('result');
        volleyButton = document.getElementById('volley');
        volleyButton.onclick = (monteCarlo ? runMonteCarlo : beginVolley);
        monteCarloCheckbox = document.getElementById('montecarlo');
        monteCarloCheckbox.onclick = function() {
            monteCarlo = monteCarloCheckbox.checked;
            volleyButton.onclick = (monteCarlo ? runMonteCarlo : beginVolley);
            redrawBoard(true);
        };
        setupBoard();
    }

    function setupBoard() {
        // initialize positions matrix
        for (var y = 0; y < boardSize; y++) {
            positions[y] = new Array(boardSize);
            for (var x = 0; x < boardSize; x++) {
                positions[y][x] = UNKNOWN;
            }
        }

        // determine hits to win given the set of ships
        hitsMade = hitsToWin = 0;
        for (var i = 0, l = ships.length; i < l; i++) {
            hitsToWin += ships[i];
        }

        distributeShips();
        recalculateProbabilities();
        redrawBoard(true);
    }

    function distributeShips() {
        var pos, shipPlaced, vertical;
        shipPositions = [];
        for (var i = 0, l = ships.length; i < l; i++) {
            shipPositions[i] = [];
            shipPlaced = false;
            vertical = randomBoolean();
            while (!shipPlaced) {
                pos = getRandomPosition();
                shipPlaced = placeShip(pos, ships[i], vertical, i);
            }
        }
    }

    function placeShip(pos, shipSize, vertical, shipIndex) {
        // "pos" is ship origin
        var x = pos[0],
            y = pos[1],
            z = (vertical ? y : x),
            end = z + shipSize - 1;

        if (shipCanOccupyPosition(SHIP, pos, shipSize, vertical)) {
            for (var i = z; i <= end; i++) {
                if (vertical) {
                    positions[x][i] = SHIP;
                    shipPositions[shipIndex][i - z] = [x, i];
                } else {
                    positions[i][y] = SHIP;
                    shipPositions[shipIndex][i - z] = [i, y];
                }
            }
            return true;
        }

        return false;
    }

    function redrawBoard(displayProbability) {
        var boardHTML = '';
        if (monteCarlo) {
            boardHTML = '<em style="color: red;">Board not visible when running Monte Carlo simulations</em>';
        } else {
            for (var y = 0; y < boardSize; y++) {
                boardHTML += '<tr>';
                for (var x = 0; x < boardSize; x++) {
                    var thisPos = positions[x][y];
                    boardHTML += '<td class="';
                    if (thisPos !== UNKNOWN) boardHTML += classMapping[thisPos];
                    boardHTML += '">';
                    if (displayProbability && thisPos != MISS && thisPos !== HIT) boardHTML += probabilities[x][y];
                    boardHTML += '</td>';
                }
                boardHTML += '</tr>';
            }
        }
        board.innerHTML = boardHTML;
    }

    function recalculateProbabilities() {
        var hits = [];

        // reset probabilities
        for (var y = 0; y < boardSize; y++) {
            probabilities[y] = new Array(boardSize);
            for (var x = 0; x < boardSize; x++) {
                probabilities[y][x] = 0;
                // we remember hits as we find them for skewing
                if (hitsSkewProbabilities && positions[x][y] === HIT) {
                    hits.push([x, y]);
                }
            }
        }

        // calculate probabilities for each type of ship
        for (var i = 0, l = ships.length; i < l; i++) {
            // Check if ship has already been sunk
            var AllHits = true;
            for (var k = 0; k < shipPositions[i].length; k++) {
                var pos = shipPositions[i][k];
                var x = pos[0];
                var y = pos[1];
                AllHits &= (positions[x][y] == HIT);
            }
            if (AllHits) continue;

            for (var y = 0; y < boardSize; y++) {
                for (var x = 0; x < boardSize; x++) {
                    // horizontal check
                    if (shipCanOccupyPosition(MISS, [x, y], ships[i], false)) {
                        increaseProbability([x, y], ships[i], false);
                    }
                    // vertical check
                    if (shipCanOccupyPosition(MISS, [x, y], ships[i], true)) {
                        increaseProbability([x, y], ships[i], true);
                    }
                }
            }
        }

        // skew probabilities for positions adjacent to hits
        if (hitsSkewProbabilities) {
            skewProbabilityAroundHits(hits);
        }
    }

    function increaseProbability(pos, shipSize, vertical) {
        // "pos" is ship origin
        var x = pos[0],
            y = pos[1],
            z = (vertical ? y : x),
            end = z + shipSize - 1;

        for (var i = z; i <= end; i++) {
            if (vertical) probabilities[x][i]++;
            else probabilities[i][y]++;
        }
    }

    function skewProbabilityAroundHits(toSkew) {
        for (var i = 0, l = toSkew.length; i < l; i++) {
            // hit position
            var x = toSkew[i][0],
                y = toSkew[i][1];
                
            // skew to the right
            if (x + 1 < boardSize) {
                if (positions[x + 1][y] === HIT) {
                    // position to the right of this hit is also a hit, so we may know the ship orientation,
                    // so mark the left/right positions with a very high probability to ensure they're used next
                    
                    // mark to the left
                    var tempx = x - 1;
                    while (tempx >= 0) {
                        if (positions[tempx][y] !== HIT) {
                            probabilities[tempx][y] = 999999;
                            break;
                        }
                        tempx--;
                    }
                    
                    // mark to the right
                    var tempx = x + 1;
                    while (tempx < boardSize) {
                        if (positions[tempx][y] !== HIT) {
                            probabilities[tempx][y] = 999999;
                            break;
                        }
                        tempx++;
                    }
                } else {
                    // to the right is not a hit, so just skew normally
                    if (probabilities[x + 1][y] != 999999) {
                        probabilities[x + 1][y] *= skewFactor;
                    }
                }
            }

            // skew to the left
            if (x - 1 >= 0) {
                // skew to the right would have already checked for multiple horizontal hits next to each other, 
                // so we can do a simple check here
                if (probabilities[x - 1][y] != 999999) {
                    probabilities[x - 1][y] *= skewFactor;
                }
            }
            
            // skew to the bottom
            if (y + 1 < boardSize) {
                if (positions[x][y + 1] === HIT) {
                    // position to the bottom of this hit is also a hit, so we may know the ship orientation,
                    // so mark the top/bottom positions with a very high probability to ensure they're used next
                    
                    // mark to the top
                    var tempy = y - 1;
                    while (tempy >= 0) {
                        if (positions[x][tempy] !== HIT) {
                            probabilities[x][tempy] = 999999;
                            break;
                        }
                        tempy--;
                    }
                    
                    // mark to the bottom
                    var tempy = y + 1;
                    while (tempy < boardSize) {
                        if (positions[x][tempy] !== HIT) {
                            probabilities[x][tempy] = 999999;
                            break;
                        }
                        tempy++;
                    }
                } else {
                    // to the bottom is not a hit, so just skew normally
                    if (probabilities[x][y + 1] != 999999) {
                        probabilities[x][y + 1] *= skewFactor;
                    }
                }
            }

            // skew to the top
            if (y - 1 >= 0) {
                // skew to the bottom would have already checked for multiple vertical hits next to each other, 
                // so we can do a simple check here
                if (probabilities[x][y - 1] != 999999) {
                    probabilities[x][y - 1] *= skewFactor;
                }
            }
        }
    }

    function getAdjacentPositions(pos) {
        var x = pos[0],
            y = pos[1],
            adj = [];

        if (y + 1 < boardSize) adj.push([x, y + 1]);
        if (y - 1 >= 0) adj.push([x, y - 1]);
        if (x + 1 < boardSize) adj.push([x + 1, y]);
        if (x - 1 >= 0) adj.push([x - 1, y]);

        return adj;
    }

    function shipCanOccupyPosition(criteriaForRejection, pos, shipSize, vertical) { // TODO: criteriaForRejection is an awkward concept, improve
        // "pos" is ship origin
        var x = pos[0],
            y = pos[1],
            z = (vertical ? y : x),
            end = z + shipSize - 1;

        // board border is too close
        if (end > boardSize - 1) return false;

        // check if there's an obstacle
        for (var i = z; i <= end; i++) {
            var thisPos = (vertical ? positions[x][i] : positions[i][y]);
            if (thisPos === criteriaForRejection) return false;
            if (thisPos === SUNK) return false;
        }

        return true;
    }

    function beginVolley() {
        if (hitsMade > 0) setupBoard();
        resultMsg.innerHTML = '';
        volleyButton.disabled = true;
        monteCarloCheckbox.disabled = true;
        var moves = 0,
            volley = setInterval(function () {
                fireAtBestPosition();
                moves++;
                if (hitsMade === hitsToWin) {
                    resultMsg.innerHTML = 'All ships sunk in ' + moves + ' moves.';
                    clearInterval(volley);
                    volleyButton.disabled = false;
                    monteCarloCheckbox.disabled = false;
                }
            }, 250);
    }

    function fireAtBestPosition() {
        var pos = getBestUnplayedPosition(),
            x = pos[0],
            y = pos[1];

        if (positions[x][y] === SHIP) {
            positions[x][y] = HIT;
            hitsMade++;
            markSunkShip(pos);
        } else positions[x][y] = MISS;

        recalculateProbabilities();
        redrawBoard(true);
    }
    
    function markSunkShip(hitPosition) {
        var hitX = hitPosition[0];
        var hitY = hitPosition[1];
        
        for (var i = 0; i < ships.length; i++) {
            for (var j = 0; j < shipPositions[i].length; j++) {
                var shipPositionX = shipPositions[i][j][0];
                var shipPositionY = shipPositions[i][j][1];
                if ((hitX == shipPositionX) && (hitY == shipPositionY)) {
                    // Found the ship in question
                    var AllHits = true;
                    for (var k = 0; k < shipPositions[i].length; k++) {
                        var pos = shipPositions[i][k];
                        var x = pos[0];
                        var y = pos[1];
                        AllHits &= (positions[x][y] == HIT);
                    }
                    if (AllHits) {
                        for (var k = 0; k < shipPositions[i].length; k++) {
                            var pos = shipPositions[i][k];
                            var x = pos[0];
                            var y = pos[1];
                            positions[x][y] = SUNK;
                        }
                    }
                    break;
                }
            }
        }
    }

    function getBestUnplayedPosition() {
        var bestProb = 0,
            bestPos;

        // so far there is no tie-breaker -- first position
        // with highest probability on board is returned
        for (var y = 0; y < boardSize; y++) {
            for (var x = 0; x < boardSize; x++) {
                if ((positions[x][y] <= SHIP) && probabilities[x][y] > bestProb) {
                    bestProb = probabilities[x][y];
                    bestPos = [x, y];
                }
            }
        }

        return bestPos;
    }

    function getRandomPosition() {
        var x = Math.floor(Math.random() * 10),
            y = Math.floor(Math.random() * 10);

        return [x, y];
    }

    function randomBoolean() {
        return (Math.round(Math.random()) == 1);
    }

    function runMonteCarlo() {
        var elapsed, sum = 0, median,
            runs = 10000,
            allMoves = new Array(runs);
            

        elapsed = (new Date()).getTime();

        for (var i = 0; i < runs; i++) {
            var moves = 0;
            setupBoard();
            while (hitsMade < hitsToWin) {
                fireAtBestPosition();
                moves++;
            }
            sum += moves;
            allMoves[i] = moves;
        }

        elapsed = (new Date()).getTime() - elapsed;
        console.log('test duration: ' + elapsed + 'ms');

        median = findMedian(allMoves);
        
        resultMsg.innerHTML = 'Average: ' + (sum / runs) + ', Median: ' + median + ' (' + runs + ' runs took ' + elapsed + 'ms)';
    }
    
    function findMedian(data) {
        data.sort(function(a, b) { return a - b; });

        var middle = Math.floor((data.length - 1) / 2); // NB: operator precedence
        if (data.length % 2) {
            return data[middle];
        } else {
            return (data[middle] + data[middle + 1]) / 2.0;
        }
    }

}(document));