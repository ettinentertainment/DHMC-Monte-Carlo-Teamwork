const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'data', 'premade_characters.json');
console.log(`Cleaning character data in: ${filePath}`);

fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return console.error(err);
    try {
        const charData = JSON.parse(data);
        charData.players.forEach(player => {
            // Clear the obsolete embedded objects.
            // The engine now builds this array at runtime from 'loadout' + Library.
            player.domainCards = [];
            console.log(`Cleaned domainCards for: ${player.name}`);
        });
        fs.writeFile(filePath, JSON.stringify(charData, null, 2), 'utf8', (err) => {
            if (err) console.error(err);
            else console.log('SUCCESS: premade_characters.json has been standardized.');
        });
    } catch (e) { console.error(e); }
});

