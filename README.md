Vercel preview location: 

Stack - Frontend: HTML & CSS, Backend: Javascript, Deployment: Github & Vercel

index.html - controls webpage html markdown
style.css - Handles webpage css for colors, fonts, positioning, etc
sim-core.js - handles global variables, instantiation of player and adversary agents, and helper functions
sim-engine.js - Handles the AI brain for Sim Logic
ui-controller.js - handles data loading, pool rendering, UI rendering, event listeners, pool filters, modal listeners


To RUN locally: 
- Download this branches zip file and extract it.
- Open the extracted file in Visual Studio.
- Download Visual Studio extension "Live Server" by Ritwick Dewy.
- Select the index.html file in the explorer window.
- Right click index.html and select Open With Live Server.
- A browser will open on a local port.
- The browser will auto refresh on each file save allowing you to preview/interact with the program.

-----Current Roadmap-----

1. Character Builder
2. Scripts to clean manual adds
3. Pool Population
4. Combat Sim Brains
5. Combat Sim Visualization
6. MultiSim Results Summary
7. User Control for PC actions (Video Game Mode)

-----TO DO-----

- Refactor Global State: Encapsulate the simulation state into a generic SimulationContext class that is passed into functions, removing dependency on window globals.
- Workerization: Move runSimulationBatch to a Web Worker to decouple simulation speed from UI rendering.
- make character builder more robust. (toggle srd adherance vs free reign, link domains to classes for srd adherance [current state is free reign], srd stat arrays vs manual input, inspect option for class, subclass, equipment, domain cards)
- GM settings panel (manually adjust fear, scale adversary resource usage, etc.)
- New workflow for concurrent encounters (New button after Sim competion to carry over fear and survivors?, gm gains 1d4 fear, players gain 1d4 hope? [simulates between battle rolls])
- Modal for playback (pop out window to show map, battle summary/stats, playback speed, css to color certain headings in sim log [round start, etc])
- Change map selection to be chosen before running sim
- Verify JSON integrity of all players and adversaries
- Create template JSON for each (adversary, player, environment) & have backend check Manual Add to pool JSONs against templates to ensure any loaded items will work properly in the ecosystem.
- Make the Sim AI Brain more robust (account for actions, tactics, feature synergies. Allow for GM difficulty dial.)
- Build out environments for additional ways for GM to spend fear.
- Implement Conditions. (Restrained actors are still making move actions.)
- Add filters to environments
- once character refactor is completed, recheck data input validation (will likely need modified to adjust to new expected player JSON structure)
- Advantage/Disadvantage Duality rolls (2d12 +- d6), adversary attack rolls (2d20 take highest/lowest)
- Fix Targeting & Interception
- Smart Adversaries
- Smart PCs



-----In Progress-----

- Character builder refactor (TO DO: clear selections after saving, add trait to weapon selection dropdown, upon clicking save button calculate any modifiers to stats from class features/domain cards [thresholds bare bones unwavering, hp, stress, etc.] ). Fix character sheet display. Add button to Traits to use recommended based on class selection. Add random character function. Implement level up pipeline.
- Data Model Refactor: Add effects to PC Domain Cards 
- Tier 1 Weapons and armor completed. Add remaining weapons/armors tier 2-4.
- Manually verify all domain cards are present, contain the correct logic and are keyed to the right domain.

-----Known Issues-----

- player and adversary pools are not loading upon startup, environments are not rendering at all. 
- Agility is currently being added to evasion. This is not Cannon and is a violation of the rules.
- adding from survivor pool to active party is occasionally blocked if fresh players are loaded into active party before attempting to move survivor
- players auto gain 2 Hope on run sim (this is fine for one off encounters but inflates hope for multi encounters b4 rest)
- GM decides to spend FEAR for an additional spotlight even though all adversaries have acted this turn (GM loses fear even though action was not taken.)
- player pool filters no longer work after class_features refactor
- adversary crits?
- on_take_damage abilities do not differentiate between allies and adversaries.
- mastery and specializations are not reading levels
