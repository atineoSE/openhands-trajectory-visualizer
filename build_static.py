#!/usr/bin/env python3
"""
Build script for static Trajectory Visualizer.
Processes conversation data and generates static JSON files.
"""

import json
import time
import shutil
import subprocess
import argparse
from pathlib import Path
from datetime import datetime


def compute_total_conversation_time(events: list) -> float:
    """Calculate total conversation time (sum of all intervals except from user messages).

    Args:
        events: List of events sorted by timestamp

    Returns:
        Total time in seconds
    """
    if len(events) < 2:
        return 0

    total_time = 0

    for i in range(1, len(events)):
        prev_event = events[i - 1]
        curr_event = events[i]

        # Only count time if the previous event was NOT from user
        if prev_event.get("source") != "user":
            prev_timestamp = prev_event.get("timestamp")
            curr_timestamp = curr_event.get("timestamp")

            if prev_timestamp and curr_timestamp:
                try:
                    prev_dt = datetime.fromisoformat(
                        prev_timestamp.replace("Z", "+00:00")
                    )
                    curr_dt = datetime.fromisoformat(
                        curr_timestamp.replace("Z", "+00:00")
                    )
                    duration = (curr_dt - prev_dt).total_seconds()
                    if duration > 0:
                        total_time += duration
                except (ValueError, TypeError):
                    pass

    return round(total_time, 1)


def compute_trajectory_metadata(trajectory_path: Path) -> dict:
    """Compute metadata for a single trajectory."""
    trajectory_id = trajectory_path.name
    base_state_path = trajectory_path / "base_state.json"
    events_dir = trajectory_path / "events"

    # Default values
    title = trajectory_id
    model = None
    prompt_tokens = 0
    completion_tokens = 0
    reasoning_tokens = 0
    cache_read_tokens = 0
    event_count = 0
    avg_agent_turn_time = 0
    total_conversation_time = 0

    # Read base_state.json
    if base_state_path.exists():
        try:
            with open(base_state_path, "r") as f:
                base_state = json.load(f)
                # Get title from agent.id
                if "agent" in base_state:
                    agent = base_state.get("agent", {})
                    if isinstance(agent, dict):
                        title = agent.get("id", trajectory_id)
                        # Get model from agent.llm.model
                        llm = agent.get("llm", {})
                        if isinstance(llm, dict):
                            model = llm.get("model")
                # Get token usage from stats
                stats = base_state.get("stats", {})
                usage = stats.get("usage_to_metrics", {})
                agent_usage = usage.get("agent", {})
                token_usage = agent_usage.get("accumulated_token_usage", {})
                prompt_tokens = token_usage.get("prompt_tokens", 0)
                completion_tokens = token_usage.get("completion_tokens", 0)
                reasoning_tokens = token_usage.get("reasoning_tokens", 0)
                cache_read_tokens = token_usage.get("cache_read_tokens", 0)
        except (json.JSONDecodeError, IOError):
            pass

    # Count events and calculate avg turn time and total conversation time
    events = []
    if events_dir.exists():
        event_files = sorted(events_dir.glob("event-*.json"))
        event_count = len(event_files)

        # Load all events
        for event_file in event_files:
            try:
                with open(event_file, "r") as f:
                    event = json.load(f)
                    events.append(event)
            except (json.JSONDecodeError, IOError):
                continue

        # Sort events by timestamp
        events.sort(key=lambda e: e.get("timestamp", ""))

        # Calculate total conversation time (excluding user message intervals)
        total_conversation_time = compute_total_conversation_time(events)

        # Calculate average agent turn time
        agent_turn_times = []
        last_trigger_timestamp = None

        for event in events:
            event_source = event.get("source")
            event_timestamp = event.get("timestamp")

            if not event_timestamp:
                continue

            if event_source == "agent" and last_trigger_timestamp:
                try:
                    current_dt = datetime.fromisoformat(
                        event_timestamp.replace("Z", "+00:00")
                    )
                    prev_dt = datetime.fromisoformat(
                        last_trigger_timestamp.replace("Z", "+00:00")
                    )
                    duration = (current_dt - prev_dt).total_seconds()
                    if duration > 0:
                        agent_turn_times.append(duration)
                except (ValueError, TypeError):
                    pass
            last_trigger_timestamp = event_timestamp

        if agent_turn_times:
            avg_agent_turn_time = round(
                sum(agent_turn_times) / len(agent_turn_times), 1
            )

    total_tokens = prompt_tokens + completion_tokens
    cache_pct = 0
    if prompt_tokens > 0:
        cache_pct = round((cache_read_tokens / prompt_tokens) * 100)

    return {
        "id": trajectory_id,
        "title": title,
        "model": model,
        "created": time.ctime(trajectory_path.stat().st_mtime),
        "eventCount": event_count,
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "reasoningTokens": reasoning_tokens,
        "cacheReadTokens": cache_read_tokens,
        "cachePct": cache_pct,
        "totalTokens": total_tokens,
        "avgAgentTurnTime": avg_agent_turn_time,
        "totalConversationTime": total_conversation_time,
    }


def build_trajectory_detail(trajectory_path: Path) -> dict:
    """Build detailed trajectory data."""
    trajectory_id = trajectory_path.name
    base_state_path = trajectory_path / "base_state.json"
    events_dir = trajectory_path / "events"

    trajectory = {
        "id": trajectory_id,
        "created": time.ctime(trajectory_path.stat().st_mtime),
        "eventCount": 0,
    }

    if base_state_path.exists():
        try:
            with open(base_state_path, "r") as f:
                base_state = json.load(f)
                trajectory["baseState"] = base_state
                agent = base_state.get("agent", {})
                if isinstance(agent, dict):
                    llm = agent.get("llm", {})
                    if isinstance(llm, dict):
                        trajectory["model"] = llm.get("model")
        except (json.JSONDecodeError, IOError):
            pass

    if events_dir.exists():
        trajectory["eventCount"] = len(list(events_dir.glob("event-*.json")))

    return trajectory


def build_events(trajectory_path: Path) -> list:
    """Build events list for a trajectory."""
    events_dir = trajectory_path / "events"

    if not events_dir.exists():
        return []

    events = []
    event_files = sorted(events_dir.glob("event-*.json"))

    for event_file in event_files:
        try:
            with open(event_file, "r") as f:
                event = json.load(f)
                events.append(event)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Error reading {event_file}: {e}")
            continue

    return events


def get_conversations_dir(input_path: Path = None) -> tuple[Path, bool]:
    """Get conversations directory and whether it's custom.

    Args:
        input_path: Optional path provided by user

    Returns:
        Tuple of (conversations_dir, is_custom)
    """
    default_dir = Path.home() / ".openhands" / "conversations"

    if input_path is None:
        # Default to ~/.openhands/conversations
        return default_dir, False

    # User provided a path - resolve it
    resolved_path = input_path.expanduser().resolve()

    # If the provided path contains a 'conversations' subdir, use that
    if (resolved_path / "conversations").is_dir():
        resolved_path = resolved_path / "conversations"

    # Check if this is the default path
    is_custom = resolved_path != default_dir

    return resolved_path, is_custom


def get_source_mtime(trajectory_path: Path) -> float:
    """Get the latest modification time across all source files in a trajectory."""
    mtime = trajectory_path.stat().st_mtime
    base_state = trajectory_path / "base_state.json"
    if base_state.exists():
        mtime = max(mtime, base_state.stat().st_mtime)
    events_dir = trajectory_path / "events"
    if events_dir.exists():
        for f in events_dir.glob("event-*.json"):
            mtime = max(mtime, f.stat().st_mtime)
    return mtime


def build_static_site(
    conversations_dir: Path, output_dir: Path, is_custom_dir: bool = False
):
    """Build the static site (incremental — only processes changed trajectories)."""
    print("🔨 Building static site...")
    print(f"   Source: {conversations_dir}")
    print(f"   Output: {output_dir}")
    print(f"   Custom dir: {is_custom_dir}")

    # Ensure output and data directories exist
    output_dir.mkdir(parents=True, exist_ok=True)
    data_dir = output_dir / "data"
    data_dir.mkdir(exist_ok=True)

    # Collect all trajectories
    trajectories = []
    source_ids = set()
    rebuilt_count = 0
    skipped_count = 0

    if not conversations_dir.exists():
        print(f"⚠️  Warning: Conversations directory not found: {conversations_dir}")
    else:
        for entry in sorted(
            conversations_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True
        ):
            # Only process directories that look like trajectory IDs (32 hex chars)
            if (
                entry.is_dir()
                and len(entry.name) == 32
                and all(c in "0123456789abcdef" for c in entry.name.lower())
            ):
                source_ids.add(entry.name)

                # Compute metadata (always needed for trajectories.json)
                metadata = compute_trajectory_metadata(entry)
                trajectories.append(metadata)

                # Check if output is already up to date
                traj_output_dir = data_dir / entry.name
                events_output = traj_output_dir / "events.json"

                if events_output.exists():
                    source_mtime = get_source_mtime(entry)
                    output_mtime = events_output.stat().st_mtime
                    if source_mtime <= output_mtime:
                        skipped_count += 1
                        continue

                # Source is newer or output doesn't exist — rebuild this trajectory
                print(f"   Processing: {entry.name}")
                rebuilt_count += 1
                traj_output_dir.mkdir(exist_ok=True)

                # Build and save trajectory detail
                trajectory_detail = build_trajectory_detail(entry)
                with open(traj_output_dir / "trajectory.json", "w") as f:
                    json.dump(trajectory_detail, f, indent=2, default=str)

                # Build and save events
                events = build_events(entry)
                with open(traj_output_dir / "events.json", "w") as f:
                    json.dump(events, f, indent=2, default=str)

    # Remove output directories for trajectories that no longer exist in source
    removed_count = 0
    for existing_output in data_dir.iterdir():
        if existing_output.is_dir() and existing_output.name not in source_ids:
            print(f"   Removing stale: {existing_output.name}")
            shutil.rmtree(existing_output)
            removed_count += 1

    print(f"\n   Rebuilt: {rebuilt_count}, Skipped (unchanged): {skipped_count}, Removed: {removed_count}")

    # Save trajectories list
    with open(data_dir / "trajectories.json", "w") as f:
        json.dump(trajectories, f, indent=2, default=str)

    # Build React app with Vite
    print("\n📦 Building React app with Vite...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=Path(__file__).parent,
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        print(f"❌ Error building React app:")
        print(result.stderr)
        return

    # The Vite build output is now in dist/, which is also our output_dir
    # We just need to inject the static configuration into the index.html

    # Inject static configuration into the built index.html
    html_output = output_dir / "index.html"
    
    if html_output.exists():
        with open(html_output, "r") as f:
            html_content = f.read()

        # Inject static configuration before the script
        static_config = f'''<script>
        window.TRAJECTORY_CONFIG = {{
            staticMode: true,
            isCustomDir: {str(is_custom_dir).lower()},
            directoryName: "{conversations_dir.name if is_custom_dir else "OpenHands"}"
        }};
        </script>
'''
        # Insert before the main script tag
        html_content = html_content.replace(
            '<script type="module" crossorigin',
            static_config + '<script type="module" crossorigin'
        )

        # Add file:// protocol detection
        file_protocol_check = '''<script>
        (function() {{
            if (window.location.protocol === 'file:') {{
                document.body.innerHTML = `
                    <div style="padding: 40px; font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                        <h1 style="color: #e76f51;">⚠️ Cannot Load Trajectories</h1>
                        <p>The Trajectory Visualizer cannot run directly from a file:// URL due to browser security restrictions.</p>
                        <h3>Solution: Use a Local Server</h3>
                        <p>Run one of these commands in the project directory:</p>
                        <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto;">
        # Option 1: Use the provided serve script
        ./serve

        # Option 2: Use Python directly
        cd dist && python3 -m http.server 8050

        # Option 3: Use npx serve
        npx serve dist -p 8050</pre>
                        <p>Then open <code>http://localhost:8050</code> in your browser.</p>
                    </div>
                `;
            }}
        }})();
        </script>
'''
        html_content = html_content.replace('</head>', file_protocol_check + '</head>')

        with open(html_output, "w") as f:
            f.write(html_content)
        print(f"   Updated: {html_output}")
    else:
        print(f"⚠️  Warning: HTML output not found: {html_output}")

    print("\n✅ Build complete!")
    print(f"   Output directory: {output_dir}")
    print(f"   Trajectories: {len(trajectories)}")
    print("\n📁 To view:")
    print("   1. Run: ./serve")
    print("   2. Visit: http://localhost:8050")
    print(f"\n   Or use: python -m http.server 8050 -d {output_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="Build static Trajectory Visualizer site"
    )
    parser.add_argument(
        "conversations_dir",
        nargs="?",
        type=Path,
        help="Directory containing conversation data (default: ~/.openhands)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).parent / "dist",
        help="Output directory for static site (default: ./dist)",
    )
    args = parser.parse_args()

    # Get conversations directory and custom flag
    conversations_dir, is_custom = get_conversations_dir(args.conversations_dir)

    build_static_site(conversations_dir, args.output_dir, is_custom)


if __name__ == "__main__":
    main()
