const fs = require('fs');
const path = require('path');

// Define the path to the file relative to the script's location
const filePath = path.join(__dirname, 'data', 'srd_adversaries.json');

console.log(`Starting adversary data remediation for: ${filePath}`);

// Read the file
fs.readFile(filePath, 'utf8', (err, data) => {
  if (err) {
    console.error(`Error reading file: ${err.message}`);
    console.error("Please ensure you are running this script from the project root directory (e.g., 'node your_script_name.js').");
    return;
  }

  try {
    const adversaries = JSON.parse(data);
    let objectsFixed = 0;
    let objectsAlreadyDone = 0;

    console.log(`Scanning ${adversaries.length} adversary objects...`);

    adversaries.forEach(adv => {
      // Check if the thresholds are in the 'Bear' (broken) nested format
      if (adv.thresholds && adv.thresholds.major !== undefined && adv.thresholds.severe !== undefined) {
        
        // Copy nested values to top level
        adv.major = adv.thresholds.major;
        adv.severe = adv.thresholds.severe;
        
        // Set thresholds to the 'Acid Burrower' (working) empty object format
        adv.thresholds = {};
        objectsFixed++;
      } else if (adv.major !== undefined && adv.severe !== undefined) {
        // This object (like Acid Burrower) is already in the correct format
        objectsAlreadyDone++;
      } else {
         // This handles objects that might have neither (like Minions)
         if (!adv.thresholds) {
            adv.thresholds = {};
         }
      }
    });

    if (objectsFixed === 0) {
      console.log(`No objects needed fixing. ${objectsAlreadyDone} objects are already in the correct format.`);
      return;
    }

    // Convert the fixed array back to a pretty-printed JSON string
    const fixedJson = JSON.stringify(adversaries, null, 2);

    // Write the file back in place
    fs.writeFile(filePath, fixedJson, 'utf8', (writeErr) => {
      if (writeErr) {
        console.error(`Error writing file: ${writeErr.message}`);
        return;
      }
      
      console.log(`SUCCESS: ${objectsFixed} adversary objects were remediated.`);
      console.log(`(${objectsAlreadyDone} objects were already in the correct format.)`);
      console.log(`The file 'srd_adversaries.json' has been successfully updated and saved.`);
    });

  } catch (parseErr) {
    console.error(`Error parsing JSON: ${parseErr.message}`);
  }
});