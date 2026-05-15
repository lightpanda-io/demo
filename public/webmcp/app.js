// Tiny notes app + WebMCP tools.
//
// The page owns the data and the DOM. The agent drives the app by calling
// the tools registered below — it never touches the DOM directly.

const state = {
    next_id: 1,
    notes: [],
};

const listEl = document.getElementById('notes');

function render() {
    listEl.innerHTML = '';
    if (state.notes.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '(no notes yet)';
        listEl.appendChild(li);
        return;
    }
    for (const note of state.notes) {
        const li = document.createElement('li');

        const title = document.createElement('span');
        title.className = 'note-title';
        title.textContent = '#' + note.id + ' ' + note.title;
        li.appendChild(title);

        if (note.body) {
            const body = document.createElement('div');
            body.className = 'note-body';
            body.textContent = note.body;
            li.appendChild(body);
        }
        listEl.appendChild(li);
    }
}

render();

// === WebMCP tools ===

navigator.modelContext.registerTool({
    name: 'list_notes',
    title: 'List notes',
    description: 'Returns every note currently in the list.',
    annotations: { readOnlyHint: true },
    execute: async () => {
        return { notes: state.notes };
    },
});

navigator.modelContext.registerTool({
    name: 'add_note',
    title: 'Add a note',
    description: 'Append a note to the list. Returns the new note id.',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Short title for the note.' },
            body: { type: 'string', description: 'Optional body text.' },
        },
        required: ['title'],
    },
    execute: async (input) => {
        const note = {
            id: state.next_id++,
            title: String(input.title ?? ''),
            body: input.body ? String(input.body) : '',
        };
        state.notes.push(note);
        render();
        return { id: note.id };
    },
});

navigator.modelContext.registerTool({
    name: 'delete_note',
    title: 'Delete a note',
    description: 'Remove a note by id. Returns whether the id was found.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'number' },
        },
        required: ['id'],
    },
    execute: async (input) => {
        const before = state.notes.length;
        state.notes = state.notes.filter((n) => n.id !== input.id);
        const deleted = state.notes.length !== before;
        if (deleted) render();
        return { deleted };
    },
});

navigator.modelContext.registerTool({
    name: 'hello',
    title: 'Send hello world',
    description: 'Send hello world',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'User\'s name' }
        },
        required: ['title'],
    },
    execute: async (input, mcp) => {
        setTimeout(() => {
            const maybe_answer = mcp.requestUserInteraction(() => true);
            maybe_answer.then((answer) => console.warn("Hello World", input.name, answer));
        }, 0);
        return {};
    },
});
