# OpenHands Trajectory Visualizer

A static site generator for visualizing OpenHands conversation trajectories.

## Features

- **Static Site Generation**: Converts OpenHands conversation data into a browsable static website
- **Trajectory Listing**: View all conversations with metadata (model, tokens, timing)
- **Event Visualization**: Browse individual events within each conversation
- **Model Statistics**: Aggregate statistics per model including token usage and timing
- **Color Coding**: Visual distinction between default and custom conversation directories

## Quick Start

### Prerequisites

- Python 3.7+
- Modern web browser

### Installation

1. Clone or download this repository
2. Ensure you have conversation data in `~/.openhands/conversations/` or specify a custom path

### Usage

#### Build the Static Site

```bash
# Default: Use ~/.openhands/conversations
./rebuild

# Custom: Use specific folder
./rebuild /path/to/conversations
./rebuild ./conversations
```

#### Serve the Site Locally

```bash
# Use the provided serve script (port 8050)
./serve

# Or use Python directly
cd dist && python3 -m http.server 8050

# Then visit http://localhost:8050
```

## Command Reference

### `./rebuild [conversations_directory]`

Builds the static site from conversation data.

**Arguments:**
- `conversations_directory` (optional): Path to conversation data. Defaults to `~/.openhands/conversations`

**Examples:**
```bash
./rebuild                          # Use default ~/.openhands/conversations
./rebuild ./conversations          # Use local folder
./rebuild /custom/path             # Use custom path
```

### `./serve [port]`

Starts a local HTTP server to serve the static site.

**Arguments:**
- `port` (optional): Port number. Defaults to 8050

**Examples:**
```bash
./serve           # Use default port 8050
./serve 8080      # Use custom port
```

### `build_static.py`

Direct Python interface for building the static site.

```bash
python3 build_static.py                    # Default ~/.openhands/conversations
python3 build_static.py /custom/path       # Custom path
python3 build_static.py --output-dir ./output  # Custom output directory
```

## Data Structure

The visualizer expects conversation data in the following structure:

```
conversations/
├── {trajectory-id-1}/
│   ├── base_state.json      # Metadata, model info, token usage
│   └── events/
│       ├── event-00000-*.json
│       ├── event-00001-*.json
│       └── ...
├── {trajectory-id-2}/
│   ├── base_state.json
│   └── events/
│       └── ...
```

## Displayed Information

### Trajectory List

Each trajectory shows:
- **ID**: Unique identifier
- **Model**: LLM model used
- **Events**: Number of events
- **Tokens**: Up (prompt) and down (completion) with cache percentage
- **Avg Turn Time**: Average time per agent turn
- **Total Time**: Total conversation duration (excluding user input time)

### Model Statistics Overlay

Click "Model Stats" to see aggregated data per model:
- Number of conversations
- Average and max turn duration
- Total tokens up (prompt) and down (completion)

### Color Coding

- **Default** (`~/.openhands/conversations`): Dark theme
- **Custom** (any other path): Yellow highlight theme

## Browser Compatibility

**Important**: Due to browser security restrictions (CORS), you cannot open `dist/index.html` directly. You must use a local HTTP server.

If you try to open the file directly, you'll see an error message with instructions.

## Development

### Project Structure

```
.
├── build_static.py          # Main build script
├── rebuild                   # Convenience rebuild script
├── serve                     # Local server script
├── trajectory-visualizer.html  # HTML template
├── conversations/            # Sample conversation data
└── dist/                     # Generated static site (after build)
```

### How It Works

1. **Build Phase** (`build_static.py`):
   - Reads conversation directories
   - Processes `base_state.json` for metadata
   - Loads all events and computes statistics
   - Generates static JSON files in `dist/data/`
   - Creates modified HTML with embedded configuration

2. **Runtime** (Browser):
   - Loads `index.html` from a web server
   - Fetches `data/trajectories.json` for the list
   - Fetches `data/{id}/events.json` for individual trajectories
   - Renders the UI with all statistics

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- Code follows existing style
- Changes are tested with sample data
- Documentation is updated
