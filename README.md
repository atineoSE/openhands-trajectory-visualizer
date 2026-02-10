# OpenHands Trajectory Visualizer

A visualizer for OpenHands conversation trajectories. Useful for debugging or simply for inspecting the conversation history.

![Event list](./img/trajectory_visualizer_event_list.png)
Event list: get all events for every agent conversation

![Action detail](./img/trajectory_visualizer_action_detail.png)
Action detail: inspect action details, blending or unblending as needed

![Model stats](./img/trajectory_visualizer_stats.png)
Model stats: inspect token usage and average turn time per model

## Setup

1. Clone this repo
2. Run `./rebuild` to generate data from all conversations in `~/.openhands/conversations`. Alternatively, provide a custom folder with `./rebuild my_custom_path`
3. Serve with `./serve`
4. Visualize in your browser from `localhost:8050`

