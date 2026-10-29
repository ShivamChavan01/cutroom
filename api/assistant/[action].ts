import { assistantHandler } from "../../apps/web/server/assistant.js";

export default assistantHandler(process.env, fetch, { hosted: true });
