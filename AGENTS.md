# OpenHands Trajectory Visualizer

## Purpose
A visualizer for OpenHands CLI conversation trajectories. Useful for debugging or inspecting conversation history, viewing event details, action details (blended or unblended), and model statistics (token usage, average turn time per model).

## Setup
1. Clone the repository
2. Run `./rebuild` to generate data from conversations in `~/.openhands/conversations` (or provide a custom folder with `./rebuild my_custom_path`)
3. Serve with `./serve`
4. Visualize in browser at `localhost:8050`

## Repository Structure
- **`trajectory-visualizer.html`**: Main HTML file containing the complete UI (sidebar, event list, action detail view, model stats)
- **`build_static.py`**: Python build script that processes conversation data from `~/.openhands/conversations` and generates static JSON files in `dist/data/`
- **`rebuild`**: Bash script wrapper that runs `build_static.py`
- **`serve`**: Bash script that starts a Python HTTP server on port 8050 to serve the static site
- **`dist/`**: Output directory (generated) containing static HTML, JSON data, and assets
- **`docs/`**: Contains example data for demonstration purposes
- **`img/`**: Contains README documentation images

## Data Structure
The visualizer processes conversation data with the following structure:
- Each conversation is identified by a 32-character hex ID
- Contains `base_state.json` with agent configuration and token usage stats
- Contains `events/` directory with individual event files (`event-*.json`)
- Computes metadata including: event count, token usage (prompt/completion/reasoning/cache), average agent turn time, total conversation time
