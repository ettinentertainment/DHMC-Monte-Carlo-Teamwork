Vercel preview location: https://dhmc-monte-carlo-teamwork-e-git-31f9ad-ettins-projects-831471cc.vercel.app/

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



-----TO DO-----

- GM settings panel (manually adjust fear, scale adversary resource usage, etc.)
- New workflow for concurrent encounters (New button after Sim competion to carry over fear and survivors?, gm gains 1d4 fear, players gain 1d4 hope? [simulates between battle rolls])
- Modal for playback (pop out window to show map, battle summary/stats, playback speed, css to color certain headings in sim log [round start, etc])
- Change map selection to be chosen before running sim
- Verify JSON integrity of all players and adversaries
- Create template JSON for each (adversary, player, environment) & have backend check Manual Add to pool JSONs against templates to ensure any loaded items will work properly in the ecosystem.
- Make the Sim AI Brain more robust (account for actions, tactics, feature synergies. Allow for GM difficulty dial.)
    - Spilt adversary Brain from Player Brain?
- Build out environments for additional ways for GM to spend fear.
- Implement Conditions.

-----In Progress-----

- Refactor to create data-driven action lexicon for Player Characters. (DONE?)
- Data Model Refactor: Add Parsed Effects to PC Domain Cards (Completed All Domains: levels 1&2)
- "Refactor: Convert Simulation Engine to Asynchronous Loop",

-----Known Issues-----

- Horde not adjusting BP when added to encounter builder
- adding from survivor pool to active party is occasionally blocked if fresh players are loaded into active party before attempting to move survivor
- players auto gain 2 Hope on run sim (this is fine for one off encounters but inflates hope for multi encounters b4 rest
- GM decides to spend FEAR for an additional spotlight even though all adversaries have acted this turn (GM loses fear even though action was not taken.)
