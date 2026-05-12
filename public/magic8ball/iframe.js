const worker = new Worker('worker.js');
const state = document.getElementById('state');
let parentOrigin = null;
let parentWindow = null;

window.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'ask') {
		parentOrigin = event.origin;
		parentWindow = event.source;
		state.textContent = 'consulting the spirits about "' + event.data.question + '"...';
		worker.postMessage(event.data.question);
	}
});

worker.addEventListener('message', (event) => {
	state.textContent = 'the spirits whisper: ' + event.data;
	if (parentWindow) {
		parentWindow.postMessage(
			{ type: 'oracle-response', answer: event.data },
			parentOrigin || '*'
		);
	}
});
