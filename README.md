\# Daggerheart Monte Carlo Simulator



This project is a conflict simulator for the Daggerheart TTRPG, designed to run Monte Carlo simulations to test adventure and encounter balance.



\## Project Architecture



1\.  \*\*Core Resolution Engine:\*\* Handles all Duality Dice (Hope/Fear) rolls.

2\.  \*\*Agent Data Models (JSON):\*\* The `.json` files for Characters, Adversaries, and Environments.

3\.  \*\*The "Brain" (Simulation Agents):\*\* Code that reads the `.json` files and makes decisions (e.g., `PC\_Agent`, `GM\_Agent`).

4\.  \*\*Action \& Ability Lexicon:\*\* A library of all the rules (cards, features) so the code can understand them.

5\.  \*\*Simulation Runner:\*\* The main loop that runs the combat.



\## Development Roadmap



\- \[X] \*\*Step 1: Core Resolution Engine.\*\* Built the `CoreResolutionEngine` class.

\- \[X] \*\*Step 2: Define Data Schemas.\*\* Created the first `monte.json` character sheet.

\- \[X] \*\*Step 3: Build the PC Agent.\*\* Taught our "brain" how to read the character JSON.

\- \[ ] \*\*Step 4: Build the GM \& Adversary Agents.\*\*

\- \[ ] \*\*Step 5: The Action Lexicon.\*\*

\- \[ ] \*\*Step 6: The Combat Loop.\*\*

