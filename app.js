'use strict';

    const STORAGE_KEY = 'organize-my-ifc-settings-v4';
    const PREVIOUS_STORAGE_KEYS = ['organize-my-ifc-settings-v3', 'organize-my-ifc-settings-v2', 'organize-my-ifc-settings-v1'];
    const NLSFB_URL = './nlsfb2021.json';
    const DEFAULT_CLASSIFICATION_ALIASES = ['Uniformat', 'Uniformat Classification'];

    const ATTRIBUTE_DEFINITIONS = [
      { key: 'storey', label: 'Bouwlaag', source: 'Bouwlaag van het element', outputName: 'Bouwlaag' },
      { key: 'name', label: 'Naam', source: 'Naam van het element', outputName: 'Naam' },
      { key: 'typeName', label: 'Type', source: 'Naam van het gekoppelde type', outputName: 'Type' },
      { key: 'ifcEntity', label: 'IFC entiteit', source: 'Naam van de IFC entiteit, bijvoorbeeld IfcWall', outputName: 'IFC entiteit' },
      { key: 'predefinedType', label: 'IFC PredefinedType', source: 'Vooraf gedefinieerd type uit het IFC schema', outputName: 'IFC PredefinedType' },
      { key: 'objectType', label: 'Objecttype', source: 'Objecttype van het element', outputName: 'Objecttype' },
    ];

    const LEGACY_DEFAULT_ATTRIBUTE_NAMES = {
      ifcEntity: 'Elementsoort',
      predefinedType: 'Typeaanduiding',
    };

    const DEFAULT_COMMON_PROPERTY_MAPPINGS = [
      { sourceName: 'IsExternal', outputName: 'Buiten' },
      { sourceName: 'LoadBearing', outputName: 'Dragend' },
      { sourceName: 'FireRating', outputName: 'WBDBO' },
      { sourceName: 'AcousticRating', outputName: 'Geluidwerendheid' },
      { sourceName: 'ThermalTransmittance', outputName: 'Warmtedoorgangscoëfficiënt' },
    ];

    const DEFAULT_SETTINGS = {
      attributes: ATTRIBUTE_DEFINITIONS.map((attribute) => ({ key: attribute.key, outputName: attribute.outputName })),
      commonPropertyMappings: DEFAULT_COMMON_PROPERTY_MAPPINGS.map((mapping) => ({ ...mapping })),
      classificationAliases: [...DEFAULT_CLASSIFICATION_ALIASES],
    };

    const elements = {
      mainView: document.getElementById('mainView'),
      settingsView: document.getElementById('settingsView'),
      openSettingsButton: document.getElementById('openSettingsButton'),
      backButton: document.getElementById('backButton'),
      restoreSettingsButton: document.getElementById('restoreSettingsButton'),
      attributeList: document.getElementById('attributeList'),
      propertyMappingList: document.getElementById('propertyMappingList'),
      addPropertyMappingButton: document.getElementById('addPropertyMappingButton'),
      classificationAliasList: document.getElementById('classificationAliasList'),
      addClassificationAliasButton: document.getElementById('addClassificationAliasButton'),
      ifcFileInput: document.getElementById('ifcFileInput'),
      dropzone: document.getElementById('dropzone'),
      emptyFileState: document.getElementById('emptyFileState'),
      selectedFileState: document.getElementById('selectedFileState'),
      selectedFileName: document.getElementById('selectedFileName'),
      selectedFileMeta: document.getElementById('selectedFileMeta'),
      removeFileButton: document.getElementById('removeFileButton'),
      psetNameInput: document.getElementById('psetNameInput'),
      visualPsetName: document.getElementById('visualPsetName'),
      processButton: document.getElementById('processButton'),
      mainError: document.getElementById('mainError'),
      statusCard: document.getElementById('statusCard'),
      statusPercent: document.getElementById('statusPercent'),
      progressBar: document.getElementById('progressBar'),
      statusMessage: document.getElementById('statusMessage'),
      resultCard: document.getElementById('resultCard'),
      resultFileDescription: document.getElementById('resultFileDescription'),
      resultSummary: document.getElementById('resultSummary'),
      downloadIfcLink: document.getElementById('downloadIfcLink'),
      warningNotice: document.getElementById('warningNotice'),
      warningDetails: document.getElementById('warningDetails'),
      warningSummary: document.getElementById('warningSummary'),
      warningList: document.getElementById('warningList'),
      settingsError: document.getElementById('settingsError'),
      dataError: document.getElementById('dataError'),
      processButtonLabel: document.getElementById('processButtonLabel'),
    };

    let selectedFile = null;
    let activeWorker = null;
    let outputIfcUrl = null;
    let activeNlsfbEntries = [];
    let nlsfbReady = false;
    let settings = loadSettings();

    initialize();

    async function initialize() {
      renderSettings(settings);
      bindEvents();
      updateVisualName();
      updateFileState();

      try {
        activeNlsfbEntries = await loadNlsfbEntries();
        nlsfbReady = true;
      } catch (error) {
        elements.dataError.textContent = 'De NL-SfB lijst kon niet worden geladen. Controleer of nlsfb2021.json naast index.html staat.';
        elements.dataError.hidden = false;
        console.error(error);
      }

      updateProcessButton();
    }

    function bindEvents() {
      elements.openSettingsButton.addEventListener('click', () => {
        renderSettings(settings);
        showView('settings');
      });

      elements.backButton.addEventListener('click', () => {
        syncSettingsFromForm();
        showView('main');
      });
      elements.restoreSettingsButton.addEventListener('click', resetSettings);
      elements.addPropertyMappingButton.addEventListener('click', () => {
        appendPropertyMappingRow({ sourceName: '', outputName: '' }, true);
      });
      elements.addClassificationAliasButton.addEventListener('click', () => {
        appendClassificationAliasRow('', true);
      });
      elements.attributeList.addEventListener('input', syncSettingsFromForm);
      elements.propertyMappingList.addEventListener('input', syncSettingsFromForm);
      elements.propertyMappingList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-mapping]');
        if (!button) return;
        const row = button.closest('[data-property-mapping-row]');
        if (row) row.remove();
        syncSettingsFromForm();
      });
      elements.classificationAliasList.addEventListener('input', syncSettingsFromForm);
      elements.classificationAliasList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-classification-alias]');
        if (!button) return;
        const row = button.closest('[data-classification-alias-row]');
        if (row) row.remove();
        syncSettingsFromForm();
      });

      elements.ifcFileInput.addEventListener('change', () => {
        const file = elements.ifcFileInput.files && elements.ifcFileInput.files[0];
        if (file) setSelectedFile(file);
      });

      elements.dropzone.addEventListener('click', (event) => {
        if (event.target.closest('#removeFileButton')) return;
        elements.ifcFileInput.click();
      });

      elements.dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          elements.ifcFileInput.click();
        }
      });

      ['dragenter', 'dragover'].forEach((name) => {
        elements.dropzone.addEventListener(name, (event) => {
          event.preventDefault();
          elements.dropzone.classList.add('is-dragging');
        });
      });

      ['dragleave', 'drop'].forEach((name) => {
        elements.dropzone.addEventListener(name, (event) => {
          event.preventDefault();
          elements.dropzone.classList.remove('is-dragging');
        });
      });

      elements.dropzone.addEventListener('drop', (event) => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) setSelectedFile(file);
      });

      elements.removeFileButton.addEventListener('click', (event) => {
        event.stopPropagation();
        clearSelectedFile();
      });

      elements.processButton.addEventListener('click', processSelectedIfc);
      elements.psetNameInput.addEventListener('input', () => {
        updateVisualName();
        updateProcessButton();
      });

    }

    function showView(view) {
      const isSettings = view === 'settings';
      elements.mainView.hidden = isSettings;
      elements.settingsView.hidden = !isSettings;
      elements.openSettingsButton.hidden = isSettings;
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function syncSettingsFromForm() {
      settings = collectSettingsFromForm();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // Instellingen blijven voor deze sessie actief wanneer lokale opslag niet beschikbaar is.
      }
      clearSettingsError();
    }

    function resetSettings() {
      settings = clone(DEFAULT_SETTINGS);
      renderSettings(settings);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        for (const previousKey of PREVIOUS_STORAGE_KEYS) localStorage.removeItem(previousKey);
      } catch {}
      clearSettingsError();
    }

    function loadSettings() {
      try {
        const current = localStorage.getItem(STORAGE_KEY);
        let storedText = current;
        let migratedFromKey = null;

        if (!storedText) {
          for (const previousKey of PREVIOUS_STORAGE_KEYS) {
            const previousValue = localStorage.getItem(previousKey);
            if (!previousValue) continue;
            storedText = previousValue;
            migratedFromKey = previousKey;
            break;
          }
        }

        const stored = JSON.parse(storedText || 'null');
        const merged = mergeSettings(stored, Boolean(migratedFromKey));

        if (!current && storedText) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            for (const previousKey of PREVIOUS_STORAGE_KEYS) localStorage.removeItem(previousKey);
          } catch {}
        }

        return merged;
      } catch {
        return clone(DEFAULT_SETTINGS);
      }
    }

    function mergeSettings(stored, migrateLegacyDefaults = false) {
      const base = clone(DEFAULT_SETTINGS);
      if (!stored || typeof stored !== 'object') return base;

      const storedAttributes = Array.isArray(stored.attributes)
        ? stored.attributes
        : Array.isArray(stored.fields) ? stored.fields : [];
      const attributeMap = new Map(storedAttributes.map((attribute) => [attribute.key, attribute]));
      base.attributes = ATTRIBUTE_DEFINITIONS.map((definition) => {
        const supplied = attributeMap.get(definition.key) || {};
        const suppliedName = String(supplied.outputName || '');
        const legacyDefaultName = LEGACY_DEFAULT_ATTRIBUTE_NAMES[definition.key];
        return {
          key: definition.key,
          outputName: suppliedName && suppliedName !== legacyDefaultName ? suppliedName : definition.outputName,
        };
      });

      if (Array.isArray(stored.commonPropertyMappings)) {
        const storedMappings = stored.commonPropertyMappings
          .map((mapping) => ({
            sourceName: String(mapping && mapping.sourceName || ''),
            outputName: String(mapping && mapping.outputName || ''),
          }))
          .filter((mapping) => mapping.sourceName || mapping.outputName);
        base.commonPropertyMappings = migrateLegacyDefaults
          ? migrateCommonPropertyMappings(storedMappings)
          : storedMappings;
      }

      if (Array.isArray(stored.classificationAliases)) {
        base.classificationAliases = cleanClassificationAliases(stored.classificationAliases);
      }

      return base;
    }

    function migrateCommonPropertyMappings(storedMappings) {
      const migrated = storedMappings.map((mapping) => {
        const sourceName = String(mapping.sourceName || '').trim();
        const outputName = String(mapping.outputName || '').trim();
        if (sourceName.toLowerCase() === 'firerating' && outputName === 'Brandwerendheid') {
          return { sourceName, outputName: 'WBDBO' };
        }
        return { sourceName, outputName };
      });

      const presentSources = new Set(migrated.map((mapping) => mapping.sourceName.toLowerCase()));
      for (const defaultMapping of DEFAULT_COMMON_PROPERTY_MAPPINGS) {
        const sourceKey = defaultMapping.sourceName.toLowerCase();
        if (!['acousticrating', 'thermaltransmittance'].includes(sourceKey)) continue;
        if (presentSources.has(sourceKey)) continue;
        migrated.push({ ...defaultMapping });
        presentSources.add(sourceKey);
      }

      return migrated;
    }

    function renderSettings(value) {
      const attributeValues = new Map((value.attributes || []).map((attribute) => [attribute.key, attribute]));
      elements.attributeList.innerHTML = '';

      for (const definition of ATTRIBUTE_DEFINITIONS) {
        const attribute = attributeValues.get(definition.key) || { outputName: definition.outputName };
        const row = document.createElement('div');
        row.className = 'attribute-row';
        row.innerHTML = `
          <div>
            <span class="attribute-name">${escapeHtml(definition.label)}</span>
            <span class="attribute-source">${escapeHtml(definition.source)}</span>
          </div>
          <div class="compact-field">
            <label for="attribute-${escapeHtml(definition.key)}">Naam in jouw tabje</label>
            <input class="input" id="attribute-${escapeHtml(definition.key)}" type="text" maxlength="255" spellcheck="false" data-attribute-output="${escapeHtml(definition.key)}" value="${escapeHtml(attribute.outputName || definition.outputName)}">
          </div>
        `;
        elements.attributeList.appendChild(row);
      }

      elements.propertyMappingList.innerHTML = '';
      for (const mapping of value.commonPropertyMappings || []) {
        appendPropertyMappingRow(mapping, false);
      }

      elements.classificationAliasList.innerHTML = '';
      for (const alias of value.classificationAliases || []) {
        appendClassificationAliasRow(alias, false);
      }

    }

    function appendPropertyMappingRow(mapping, focusSource) {
      const row = document.createElement('div');
      row.className = 'property-mapping-row';
      row.setAttribute('data-property-mapping-row', '');
      row.innerHTML = `
        <div class="compact-field">
          <label>Eigenschap in het model</label>
          <input class="input" type="text" maxlength="255" spellcheck="false" data-mapping-source value="${escapeHtml(mapping.sourceName || '')}" placeholder="bijvoorbeeld AcousticRating">
        </div>
        <div class="compact-field">
          <label>Naam in jouw tabje</label>
          <input class="input" type="text" maxlength="255" spellcheck="false" data-mapping-output value="${escapeHtml(mapping.outputName || '')}" placeholder="bijvoorbeeld Geluidwerendheid">
        </div>
        <button class="button button-quiet remove-mapping-button" type="button" data-remove-mapping aria-label="Koppeling verwijderen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/>
          </svg>
        </button>
      `;
      elements.propertyMappingList.appendChild(row);
      if (focusSource) {
        const input = row.querySelector('[data-mapping-source]');
        if (input) input.focus();
      }
    }

    function appendClassificationAliasRow(alias, focusInput) {
      const row = document.createElement('div');
      row.className = 'classification-alias-row';
      row.setAttribute('data-classification-alias-row', '');
      row.innerHTML = `
        <div class="compact-field">
          <label>Naam in het model</label>
          <input class="input" type="text" maxlength="255" spellcheck="false" data-classification-alias value="${escapeHtml(alias || '')}" placeholder="bijvoorbeeld Assembly Code">
        </div>
        <button class="button button-quiet remove-mapping-button" type="button" data-remove-classification-alias aria-label="Classificatiemethode verwijderen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/>
          </svg>
        </button>
      `;
      elements.classificationAliasList.appendChild(row);
      if (focusInput) {
        const input = row.querySelector('[data-classification-alias]');
        if (input) input.focus();
      }
    }

    function cleanClassificationAliases(values) {
      const result = [];
      const seen = new Set();
      for (const value of Array.isArray(values) ? values : []) {
        const alias = String(value || '').trim();
        const key = alias.toLocaleLowerCase('nl-NL');
        if (!alias || seen.has(key)) continue;
        seen.add(key);
        result.push(alias);
      }
      return result;
    }

    function collectSettingsFromForm() {
      const attributes = ATTRIBUTE_DEFINITIONS.map((definition) => ({
        key: definition.key,
        outputName: document.querySelector(`[data-attribute-output="${definition.key}"]`).value.trim(),
      }));

      const commonPropertyMappings = Array.from(elements.propertyMappingList.querySelectorAll('[data-property-mapping-row]'))
        .map((row) => ({
          sourceName: row.querySelector('[data-mapping-source]').value.trim(),
          outputName: row.querySelector('[data-mapping-output]').value.trim(),
        }))
        .filter((mapping) => mapping.sourceName || mapping.outputName);

      const classificationAliases = cleanClassificationAliases(
        Array.from(elements.classificationAliasList.querySelectorAll('[data-classification-alias]'))
          .map((input) => input.value),
      );

      return {
        attributes,
        commonPropertyMappings,
        classificationAliases,
      };
    }

    function validateSettings(value) {
      const usedNames = new Set(['nl-sfb code', 'nl-sfb omschrijving']);

      for (const attribute of value.attributes) {
        if (!attribute.outputName) throw new Error('Geef iedere vaste IFC waarde een naam.');
        const normalized = attribute.outputName.toLowerCase();
        if (usedNames.has(normalized)) throw new Error(`De naam “${attribute.outputName}” wordt meer dan één keer gebruikt.`);
        usedNames.add(normalized);
      }

      for (const mapping of value.commonPropertyMappings) {
        if (!mapping.sourceName || !mapping.outputName) {
          throw new Error('Vul bij iedere regel de eigenschap en de naam in.');
        }
        const normalized = mapping.outputName.toLowerCase();
        if (usedNames.has(normalized)) throw new Error(`De naam “${mapping.outputName}” wordt meer dan één keer gebruikt.`);
        usedNames.add(normalized);
      }
    }

    function setSelectedFile(file) {
      clearMainError();
      if (!file || !/\.ifc$/i.test(file.name)) {
        showMainError('Kies een bestand met de extensie .ifc.');
        return;
      }
      selectedFile = file;
      elements.ifcFileInput.value = '';
      resetResult();
      updateFileState();
    }

    function clearSelectedFile() {
      selectedFile = null;
      elements.ifcFileInput.value = '';
      resetResult();
      updateFileState();
    }

    function updateFileState() {
      const hasFile = Boolean(selectedFile);
      elements.emptyFileState.hidden = hasFile;
      elements.selectedFileState.hidden = !hasFile;
      if (hasFile) {
        elements.selectedFileName.textContent = selectedFile.name;
        elements.selectedFileMeta.textContent = `${formatBytes(selectedFile.size)} · lokaal bestand`;
      }
      updateProcessButton();
    }

    function updateVisualName() {
      const value = elements.psetNameInput.value.trim() || 'Cpset_';
      elements.visualPsetName.textContent = value.length > 18 ? `${value.slice(0, 17)}…` : value;
    }

    function updateProcessButton() {
      elements.processButton.disabled = !selectedFile || !elements.psetNameInput.value.trim() || !nlsfbReady || Boolean(activeWorker);
    }

    async function processSelectedIfc() {
      clearMainError();
      resetResult();

      try {
        if (!selectedFile) throw new Error('Kies eerst een IFC bestand.');
        const targetPsetName = elements.psetNameInput.value.trim();
        if (!targetPsetName) throw new Error('Kies een naam voor jouw eigenschappen tabje.');

        validateSettings(settings);
        setBusy(true);
        updateProgress(0, 'Voorbereiden');
        elements.statusCard.hidden = false;

        if (!nlsfbReady) throw new Error('De NL-SfB lijst is nog niet beschikbaar.');
        const worker = new Worker('./worker.js');
        activeWorker = worker;

        worker.onmessage = async (event) => {
          const message = event.data || {};
          if (message.type === 'progress') {
            updateProgress(message.percent, message.message);
            return;
          }

          if (message.type === 'error') {
            finishWorker();
            elements.statusCard.hidden = true;
            showMainError(message.message || 'De IFC verwerking is mislukt.');
            return;
          }

          if (message.type === 'done') {
            finishWorker();
            updateProgress(100, 'Gereed');
            elements.statusCard.hidden = true;
            await showResult(message.blob, message.summary, message.report, targetPsetName);
          }
        };

        worker.onerror = (event) => {
          finishWorker();
          elements.statusCard.hidden = true;
          showMainError(event.message || 'De verwerkingsmodule kon niet worden gestart.');
        };

        worker.postMessage({
          type: 'process',
          file: selectedFile,
          config: {
            ...settings,
            targetPsetName,
            sourceFileName: selectedFile.name,
          },
          nlsfbEntries: activeNlsfbEntries,
        });
      } catch (error) {
        finishWorker();
        elements.statusCard.hidden = true;
        showMainError(error.message || String(error));
      }
    }

    function finishWorker() {
      if (activeWorker) activeWorker.terminate();
      activeWorker = null;
      setBusy(false);
    }

    function setBusy(busy) {
      elements.processButton.disabled = busy || !selectedFile || !elements.psetNameInput.value.trim() || !nlsfbReady;
      elements.psetNameInput.disabled = busy;
      elements.openSettingsButton.disabled = busy;
      elements.removeFileButton.disabled = busy;
      elements.processButtonLabel.textContent = busy ? 'Bezig met organiseren' : 'Organiseer IFC';
    }

    function updateProgress(percent, message) {
      const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
      elements.statusPercent.textContent = `${safePercent}%`;
      elements.progressBar.style.width = `${safePercent}%`;
      elements.statusMessage.textContent = message || '';
    }

    async function showResult(blob, summary, report, targetPsetName) {
      revokeOutputUrls();
      const baseName = selectedFile.name.replace(/\.ifc$/i, '');
      const safeSuffix = targetPsetName.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '') || 'Pset';
      const outputName = `${baseName}_${safeSuffix}.ifc`;

      outputIfcUrl = URL.createObjectURL(blob);

      elements.downloadIfcLink.href = outputIfcUrl;
      elements.downloadIfcLink.download = outputName;
      elements.resultFileDescription.textContent = `${outputName} · ${formatBytes(blob.size)}`;

      const resultParts = [
        `${formatNumber(summary.processedElements)} elementen georganiseerd`,
        `${formatNumber(summary.propertiesAdded)} eigenschappen gebundeld`,
      ];
      if (Number(summary.sourceClassificationsFound || 0) > 0) {
        resultParts.push(`${formatNumber(summary.sourceClassificationsFound)} NL-SfB koppelingen gevonden`);
      }
      elements.resultSummary.textContent = resultParts.join(' · ');
      renderWarnings(report, summary);
      elements.resultCard.hidden = false;
      elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderWarnings(report, summary) {
      const warnings = Array.isArray(report.warnings) ? report.warnings : [];
      const unresolved = Array.isArray(report.unresolvedClassificationCodes) ? report.unresolvedClassificationCodes : [];
      const warningCount = Number(summary.warningCount || 0);
      const hasWarnings = warningCount > 0 || unresolved.length > 0 || Number(summary.sourceDescriptionsMissing || 0) > 0;

      elements.warningNotice.hidden = !hasWarnings;
      elements.warningDetails.hidden = !hasWarnings;
      elements.warningList.innerHTML = '';

      if (!hasWarnings) return;

      const total = warningCount + unresolved.length;
      elements.warningNotice.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>
        <span>De export is gemaakt, maar controleer de meldingen. Codes zonder match in de NL-SfB JSON krijgen de omschrijving “Onbekende NL-SfB codering”.</span>
      `;
      elements.warningSummary.textContent = `${total.toLocaleString('nl-NL')} meldingen bekijken`;

      for (const code of unresolved.slice(0, 100)) {
        const item = document.createElement('li');
        item.textContent = `Code “${code}” staat niet in de NL-SfB JSON en heeft de omschrijving “Onbekende NL-SfB codering” gekregen.`;
        elements.warningList.appendChild(item);
      }

      for (const warning of warnings.slice(0, 150)) {
        const item = document.createElement('li');
        item.textContent = `${warning.expressId ? `#${warning.expressId}: ` : ''}${warning.message}`;
        elements.warningList.appendChild(item);
      }
    }

    function resetResult() {
      elements.resultCard.hidden = true;
      elements.statusCard.hidden = true;
      elements.warningNotice.hidden = true;
      elements.warningDetails.hidden = true;
      revokeOutputUrls();
      updateProgress(0, 'Voorbereiden');
    }

    function revokeOutputUrls() {
      if (outputIfcUrl) URL.revokeObjectURL(outputIfcUrl);
      outputIfcUrl = null;
    }

    function parseJsonTolerant(text) {
      try {
        return JSON.parse(text);
      } catch {
        return JSON.parse(removeTrailingJsonCommas(text));
      }
    }

    function removeTrailingJsonCommas(text) {
      let output = '';
      let inString = false;
      let escaped = false;

      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
          output += char;
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }

        if (char === '"') {
          inString = true;
          output += char;
          continue;
        }

        if (char === ',') {
          let cursor = index + 1;
          while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
          if (text[cursor] === '}' || text[cursor] === ']') continue;
        }

        output += char;
      }
      return output;
    }

    function extractNlsfbEntries(data) {
      if (!data || !Array.isArray(data.Classes)) throw new Error('Veld “Classes” ontbreekt.');
      const entries = data.Classes
        .filter((item) => item && item.Code != null)
        .map((item) => [String(item.Code), String(item.Name || ''), String(item.OwnedUri || ''), String(item.ParentClassCode || '')]);
      if (!entries.length) throw new Error('Er zijn geen classificatiecodes gevonden.');
      return entries;
    }


    async function loadNlsfbEntries() {
      const response = await fetch(NLSFB_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`NL-SfB bestand kon niet worden geladen (${response.status}).`);
      const text = await response.text();
      return extractNlsfbEntries(parseJsonTolerant(text));
    }

    function showMainError(message) {
      elements.mainError.textContent = message;
      elements.mainError.hidden = false;
    }

    function clearMainError() {
      elements.mainError.hidden = true;
      elements.mainError.textContent = '';
    }

    function showSettingsError(message) {
      elements.settingsError.textContent = message;
      elements.settingsError.hidden = false;
      elements.settingsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function clearSettingsError() {
      elements.settingsError.hidden = true;
      elements.settingsError.textContent = '';
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024) return `${value} B`;
      const units = ['kB', 'MB', 'GB'];
      let size = value / 1024;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }
      return `${size.toLocaleString('nl-NL', { maximumFractionDigits: size >= 10 ? 1 : 2 })} ${units[unitIndex]}`;
    }

    function formatNumber(value) {
      return Number(value || 0).toLocaleString('nl-NL');
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function safeParse(value, fallback) {
      try { return JSON.parse(value); } catch { return clone(fallback); }
    }

    window.addEventListener('beforeunload', revokeOutputUrls);
