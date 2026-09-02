import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { pingroomChannelPlugin } from "./channel.js";

/**
 * Loaded instead of the full entry when the channel is disabled or
 * unconfigured, so an unused plugin costs a module load and nothing else.
 */
export default defineSetupPluginEntry(pingroomChannelPlugin as never);
