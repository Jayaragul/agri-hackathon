import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
virtualConsole.sendTo(console);

virtualConsole.on("jsdomError", (e) => {
  console.error(e);
});

JSDOM.fromURL("http://localhost:5173/", {
  runScripts: "dangerously",
  resources: "usable",
  virtualConsole
}).then(dom => {
  setTimeout(() => {
    console.log("BODY:", dom.window.document.body.innerHTML);
    process.exit(0);
  }, 3000);
}).catch(console.error);
