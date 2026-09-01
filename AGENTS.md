# Agent Guidelines - acr-node

## Local Node Runtime & Duality Routing Discipline
1. **Client-Side Iroh P2P**: Native QUIC dialing with NAT traversal runs locally on the agent node process.
2. **4-Step Duality Routing**: Route direct P2P on LAN/reachable NAT -> Fall back to Cloud Relay / Room Broadcast when remote or multi-party.
3. **CRDT Presence Decoupling**: Ephemeral typing indicators and cursor presence sync via Yjs CRDT decoupled from database persistence.
