(() => {
  const STORAGE_KEY = "commandPanelUrlMappings";
  const form = document.querySelector("#mapping-form");
  const idInput = document.querySelector("#mapping-id");
  const nameInput = document.querySelector("#mapping-input");
  const urlInput = document.querySelector("#mapping-url");
  const saveButton = document.querySelector("#save-button");
  const cancelButton = document.querySelector("#cancel-button");
  const message = document.querySelector("#form-message");
  const list = document.querySelector("#mapping-list");
  const count = document.querySelector("#mapping-count");
  let mappings = [];

  form.addEventListener("submit", saveMapping);
  cancelButton.addEventListener("click", resetForm);
  loadMappings();

  async function loadMappings() {
    const values = await chrome.storage.local.get(STORAGE_KEY);
    mappings = Array.isArray(values[STORAGE_KEY]) ? values[STORAGE_KEY] : [];
    renderMappings();
  }

  async function saveMapping(event) {
    event.preventDefault();
    const input = nameInput.value.trim();
    const url = normalizeUrl(urlInput.value);
    const editingId = idInput.value;

    if (!input) {
      showMessage("Enter the input text.", true);
      return;
    }
    if (!url) {
      showMessage("Enter a valid http:// or https:// URL.", true);
      return;
    }

    const duplicate = mappings.find((mapping) => {
      return mapping.id !== editingId && mapping.input.trim().toLocaleLowerCase() === input.toLocaleLowerCase();
    });
    if (duplicate) {
      showMessage(`“${input}” already has a mapping.`, true);
      return;
    }

    if (editingId) {
      mappings = mappings.map((mapping) => mapping.id === editingId ? { ...mapping, input, url } : mapping);
    } else {
      mappings = [...mappings, { id: crypto.randomUUID(), input, url }];
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: mappings });
    renderMappings();
    resetForm();
    showMessage(editingId ? "Mapping updated." : "Mapping added.");
  }

  function normalizeUrl(value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function renderMappings() {
    list.textContent = "";
    count.textContent = `${mappings.length} saved`;

    if (mappings.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No mappings yet. Add your first one above.";
      list.append(empty);
      return;
    }

    for (const mapping of mappings) {
      const row = document.createElement("article");
      row.className = "mapping-row";

      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = mapping.input;
      const url = document.createElement("span");
      url.textContent = mapping.url;
      details.append(name, url);

      const actions = document.createElement("div");
      actions.className = "row-actions";
      const edit = createButton("Edit", () => editMapping(mapping));
      const remove = createButton("Delete", () => deleteMapping(mapping.id), "danger");
      actions.append(edit, remove);
      row.append(details, actions);
      list.append(row);
    }
  }

  function createButton(label, handler, className = "secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function editMapping(mapping) {
    idInput.value = mapping.id;
    nameInput.value = mapping.input;
    urlInput.value = mapping.url;
    saveButton.textContent = "Save changes";
    cancelButton.hidden = false;
    nameInput.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteMapping(id) {
    mappings = mappings.filter((mapping) => mapping.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: mappings });
    if (idInput.value === id) {
      resetForm();
    }
    renderMappings();
    showMessage("Mapping deleted.");
  }

  function resetForm() {
    form.reset();
    idInput.value = "";
    saveButton.textContent = "Add mapping";
    cancelButton.hidden = true;
  }

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.dataset.error = String(isError);
  }
})();
