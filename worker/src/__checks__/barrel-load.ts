// Boot-time smoke: can the collapsed store barrel + key worker modules load?
import * as store from "../store/index.js";
console.log("barrel exports:", Object.keys(store).length);
for (const name of ["createRun", "getRun", "setRunStatus", "stripRunByok", "listLatestDocuments", "appendEvent", "applyProposal", "pingDb", "assertEnvironmentIdentity"]) {
  console.log(name, typeof (store as Record<string, unknown>)[name]);
}
