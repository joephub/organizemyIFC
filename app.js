'use strict';

    const STORAGE_KEY = 'organize-my-ifc-settings-v6';
    const PREVIOUS_STORAGE_KEYS = ['organize-my-ifc-settings-v5', 'organize-my-ifc-settings-v4', 'organize-my-ifc-settings-v3', 'organize-my-ifc-settings-v2', 'organize-my-ifc-settings-v1'];
    const NLSFB_URL = './nlsfb2021.json';
    const CONSTRUCTION_SEQUENCE_URL = './bouwvolgorde_nlsfb.json';
    const DEFAULT_CLASSIFICATION_ALIASES = ['Uniformat', 'Uniformat Classification'];
    const DEFAULT_PROPERTY_PSET_PATTERN = 'Pset_.*Common';

    const ATTRIBUTE_DEFINITIONS = [
      { key: 'storey', label: 'Bouwlaag', source: 'Bouwlaag van het element', outputName: 'Bouwlaag' },
      { key: 'name', label: 'Naam', source: 'Naam van het element', outputName: 'Naam' },
      { key: 'typeName', label: 'Type', source: 'Naam van het gekoppelde type', outputName: 'Type' },
      { key: 'ifcEntity', label: 'IFC entiteit', source: 'Naam van de IFC entiteit, bijvoorbeeld IfcWall', outputName: 'IFC entiteit' },
      { key: 'predefinedType', label: 'IFC PredefinedType', source: 'Vooraf gedefinieerd type uit het IFC schema', outputName: 'IFC PredefinedType' },
      { key: 'objectType', label: 'Objecttype', source: 'Objecttype van het element', outputName: 'Objecttype' },
      { key: 'materials', label: 'Materiaal', source: 'Alle gekoppelde materiaalnamen', outputName: 'Materiaal' },
    ];

    const LEGACY_DEFAULT_ATTRIBUTE_NAMES = {
      ifcEntity: 'Elementsoort',
      predefinedType: 'Typeaanduiding',
    };

    const DEFAULT_COMMON_PROPERTY_MAPPINGS = [
      { psetPattern: DEFAULT_PROPERTY_PSET_PATTERN, sourceName: 'IsExternal', outputName: 'Buiten' },
      { psetPattern: DEFAULT_PROPERTY_PSET_PATTERN, sourceName: 'LoadBearing', outputName: 'Dragend' },
      { psetPattern: DEFAULT_PROPERTY_PSET_PATTERN, sourceName: 'FireRating', outputName: 'WBDBO' },
      { psetPattern: DEFAULT_PROPERTY_PSET_PATTERN, sourceName: 'AcousticRating', outputName: 'Geluidwerendheid' },
      { psetPattern: DEFAULT_PROPERTY_PSET_PATTERN, sourceName: 'ThermalTransmittance', outputName: 'Warmtedoorgangscoëfficiënt' },
    ];

    const DEFAULT_SETTINGS = {
      attributes: ATTRIBUTE_DEFINITIONS.map((attribute) => ({ key: attribute.key, outputName: attribute.outputName })),
      commonPropertyMappings: DEFAULT_COMMON_PROPERTY_MAPPINGS.map((mapping) => ({ ...mapping })),
      classificationAliases: [...DEFAULT_CLASSIFICATION_ALIASES],
      addConstructionSequence: false,
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
      addConstructionSequenceInput: document.getElementById('addConstructionSequenceInput'),
      constructionSequenceInfoButton: document.getElementById('constructionSequenceInfoButton'),
      constructionSequenceInfoDialog: document.getElementById('constructionSequenceInfoDialog'),
      closeConstructionSequenceInfoButton: document.getElementById('closeConstructionSequenceInfoButton'),
      constructionSequenceOverviewCount: document.getElementById('constructionSequenceOverviewCount'),
      constructionSequencePhaseRail: document.getElementById('constructionSequencePhaseRail'),
      constructionSequencePhaseList: document.getElementById('constructionSequencePhaseList'),
      expandConstructionSequencePhasesButton: document.getElementById('expandConstructionSequencePhasesButton'),
      collapseConstructionSequencePhasesButton: document.getElementById('collapseConstructionSequencePhasesButton'),
      ifcFileInput: document.getElementById('ifcFileInput'),
      dropzone: document.getElementById('dropzone'),
      emptyFileState: document.getElementById('emptyFileState'),
      selectedFileState: document.getElementById('selectedFileState'),
      selectedFileName: document.getElementById('selectedFileName'),
      selectedFileMeta: document.getElementById('selectedFileMeta'),
      selectedFileList: document.getElementById('selectedFileList'),
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
      resultTitle: document.getElementById('resultTitle'),
      resultFileDescription: document.getElementById('resultFileDescription'),
      resultSummary: document.getElementById('resultSummary'),
      downloadIfcLink: document.getElementById('downloadIfcLink'),
      downloadButtonLabel: document.getElementById('downloadButtonLabel'),
      warningNotice: document.getElementById('warningNotice'),
      warningDetails: document.getElementById('warningDetails'),
      warningSummary: document.getElementById('warningSummary'),
      warningList: document.getElementById('warningList'),
      settingsError: document.getElementById('settingsError'),
      dataError: document.getElementById('dataError'),
      processButtonLabel: document.getElementById('processButtonLabel'),
    };

    let selectedFiles = [];
    let activeWorker = null;
    let outputIfcUrl = null;
    let isProcessing = false;
    let activeNlsfbEntries = [];
    let nlsfbReady = false;
    let activeConstructionSequenceConfig = null;
    let constructionSequenceReady = false;
    let constructionSequenceLoadError = null;
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

      try {
        activeConstructionSequenceConfig = await loadConstructionSequenceConfig();
        constructionSequenceReady = true;
        renderConstructionSequenceOverview(activeConstructionSequenceConfig);
      } catch (error) {
        constructionSequenceLoadError = error;
        renderConstructionSequenceOverviewError(error);
        console.error(error);
      }

      updateConstructionSequenceAvailability();
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
        appendPropertyMappingRow({ psetPattern: DEFAULT_PROPERTY_PSET_PATTERN, sourceName: '', outputName: '' }, true);
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
      elements.addConstructionSequenceInput.addEventListener('change', () => {
        syncSettingsFromForm();
        updateConstructionSequenceAvailability();
        updateProcessButton();
      });
      elements.constructionSequenceInfoButton.addEventListener('click', openConstructionSequenceInfo);
      elements.closeConstructionSequenceInfoButton.addEventListener('click', closeConstructionSequenceInfo);
      elements.constructionSequenceInfoDialog.addEventListener('click', (event) => {
        if (event.target === elements.constructionSequenceInfoDialog) closeConstructionSequenceInfo();
      });
      elements.constructionSequenceInfoDialog.addEventListener('close', () => {
        elements.constructionSequenceInfoButton.focus();
      });
      elements.expandConstructionSequencePhasesButton.addEventListener('click', () => {
        setConstructionSequencePhasesOpen(true);
      });
      elements.collapseConstructionSequencePhasesButton.addEventListener('click', () => {
        setConstructionSequencePhasesOpen(false);
      });
      elements.constructionSequencePhaseRail.addEventListener('click', (event) => {
        const button = event.target.closest('[data-sequence-phase-target]');
        if (!button) return;
        const target = document.getElementById(button.dataset.sequencePhaseTarget || '');
        if (!target) return;
        target.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      elements.ifcFileInput.addEventListener('change', () => {
        const files = Array.from(elements.ifcFileInput.files || []);
        if (files.length) setSelectedFiles(files);
      });

      elements.dropzone.addEventListener('click', (event) => {
        if (isProcessing || event.target.closest('#removeFileButton')) return;
        elements.ifcFileInput.click();
      });

      elements.dropzone.addEventListener('keydown', (event) => {
        if (!isProcessing && (event.key === 'Enter' || event.key === ' ')) {
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
        if (isProcessing) return;
        const files = Array.from(event.dataTransfer && event.dataTransfer.files || []);
        if (files.length) setSelectedFiles(files);
      });

      elements.removeFileButton.addEventListener('click', (event) => {
        event.stopPropagation();
        clearSelectedFiles();
      });

      elements.processButton.addEventListener('click', processSelectedIfc);
      elements.psetNameInput.addEventListener('input', () => {
        updateVisualName();
        updateProcessButton();
      });

    }

    function openConstructionSequenceInfo() {
      if (activeConstructionSequenceConfig) {
        renderConstructionSequenceOverview(activeConstructionSequenceConfig);
      } else if (constructionSequenceLoadError) {
        renderConstructionSequenceOverviewError(constructionSequenceLoadError);
      }
      const dialog = elements.constructionSequenceInfoDialog;
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      dialog.scrollTop = 0;
    }

    function renderConstructionSequenceOverview(config) {
      const phases = Array.isArray(config && config.fases)
        ? [...config.fases].sort((left, right) => Number(left.fase_id) - Number(right.fase_id))
        : [];

      if (!phases.length) {
        elements.constructionSequenceOverviewCount.textContent = 'Geen fasen gevonden';
        elements.constructionSequencePhaseRail.innerHTML = '';
        elements.constructionSequencePhaseList.innerHTML = '<p class="sequence-overview-loading">Geen fasen gevonden in bouwvolgorde_nlsfb.json.</p>';
        return;
      }

      const sequenceSettings = config.instellingen || {};
      const phaseWidth = Math.max(1, Number(sequenceSettings.fase_breedte) || 2);
      const stepWidth = Math.max(1, Number(sequenceSettings.stap_breedte) || 2);
      const zWidth = Math.max(1, Number(sequenceSettings.bouwlaag_z_breedte) || 6);
      const codeFormat = String(sequenceSettings.code_formaat || '{fase}.{bouwlaag_z}.{stap}');
      const zPlaceholder = 'Z'.repeat(Math.min(zWidth, 12));
      const totalSteps = phases.reduce((total, phase) => total + (Array.isArray(phase.stappen) ? phase.stappen.length : 0), 0);

      elements.constructionSequenceOverviewCount.textContent = `${phases.length} ${phases.length === 1 ? 'fase' : 'fasen'} · ${totalSteps} ${totalSteps === 1 ? 'stap' : 'stappen'}`;
      elements.constructionSequencePhaseRail.innerHTML = phases.map((phase, index) => {
        const phaseNumber = padSequenceNumber(phase.fase_id, phaseWidth);
        const targetId = `construction-sequence-phase-${index + 1}`;
        return `
          <button class="sequence-phase-rail-item" type="button" data-sequence-phase-target="${targetId}" title="${escapeHtml(String(phase.fase_naam || ''))}">
            <span>${escapeHtml(phaseNumber)}</span>
            <strong>${escapeHtml(String(phase.fase_naam || `Fase ${phaseNumber}`))}</strong>
          </button>`;
      }).join('');

      elements.constructionSequencePhaseList.innerHTML = phases.map((phase, index) => {
        const phaseNumber = padSequenceNumber(phase.fase_id, phaseWidth);
        const phaseName = String(phase.fase_naam || `Fase ${phaseNumber}`);
        const phaseIndication = String(phase.bouwlaag_indicatie || '');
        const steps = Array.isArray(phase.stappen)
          ? [...phase.stappen].sort((left, right) => Number(left.volgorde_nummer) - Number(right.volgorde_nummer))
          : [];
        const targetId = `construction-sequence-phase-${index + 1}`;

        const stepItems = steps.map((step) => {
          const stepNumber = padSequenceNumber(step.volgorde_nummer, stepWidth);
          const codePattern = codeFormat
            .replaceAll('{fase}', phaseNumber)
            .replaceAll('{bouwlaag_z}', zPlaceholder)
            .replaceAll('{stap}', stepNumber);
          const codes = Array.isArray(step.nlsfb_codes) ? step.nlsfb_codes.map((code) => String(code)) : [];
          const codeChips = codes.length
            ? codes.map((code) => `<span class="sequence-nlsfb-chip">${escapeHtml(code)}</span>`).join('')
            : '<span class="sequence-nlsfb-chip is-empty">Geen code</span>';
          const scope = constructionSequenceScopeLabel(step.bouwlaag_selectie);
          return `
            <li class="sequence-step-item">
              <code class="sequence-step-code">${escapeHtml(codePattern)}</code>
              <div class="sequence-step-content">
                <strong>${escapeHtml(String(step.omschrijving || 'Naamloze stap'))}</strong>
                <div class="sequence-step-meta">
                  <span class="sequence-step-codes" aria-label="NL-SfB codes">${codeChips}</span>
                  <span class="sequence-step-scope">${escapeHtml(scope)}</span>
                </div>
              </div>
            </li>`;
        }).join('');

        return `
          <details class="sequence-phase-detail" id="${targetId}" data-sequence-phase-detail open>
            <summary>
              <span class="sequence-phase-number">${escapeHtml(phaseNumber)}</span>
              <span class="sequence-phase-summary-text">
                <strong>${escapeHtml(phaseName)}</strong>
                <small>${escapeHtml(phaseIndication)}</small>
              </span>
              <span class="sequence-phase-step-count">${steps.length} ${steps.length === 1 ? 'stap' : 'stappen'}</span>
              <svg class="sequence-phase-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>
            </summary>
            <ol class="sequence-step-list">${stepItems}</ol>
          </details>`;
      }).join('');
    }

    function renderConstructionSequenceOverviewError(error) {
      elements.constructionSequenceOverviewCount.textContent = 'Niet beschikbaar';
      elements.constructionSequencePhaseRail.replaceChildren();
      elements.constructionSequencePhaseList.replaceChildren();
      const state = document.createElement('p');
      state.className = 'sequence-overview-loading is-error';
      state.textContent = 'Het overzicht kon niet uit bouwvolgorde_nlsfb.json worden geladen.';
      if (error && error.message) state.title = String(error.message);
      elements.constructionSequencePhaseList.append(state);
    }

    function setConstructionSequencePhasesOpen(open) {
      elements.constructionSequencePhaseList.querySelectorAll('[data-sequence-phase-detail]').forEach((detail) => {
        detail.open = open;
      });
    }

    function constructionSequenceScopeLabel(value) {
      const labels = {
        laagste: 'Laagste bouwlaag',
        hoogste: 'Hoogste bouwlaag',
        per_bouwlaag: 'Per bouwlaag',
        vanaf_tweede: 'Vanaf tweede bouwlaag',
      };
      const key = String(value || '').trim();
      return labels[key] || key.replace(/_/g, ' ') || 'Per bouwlaag';
    }

    function padSequenceNumber(value, width) {
      const numeric = Number(value);
      const normalized = Number.isFinite(numeric) ? Math.round(numeric) : 0;
      return String(normalized).padStart(width, '0');
    }

    function closeConstructionSequenceInfo() {
      const dialog = elements.constructionSequenceInfoDialog;
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else {
        dialog.removeAttribute('open');
        elements.constructionSequenceInfoButton.focus();
      }
    }

    function showView(view) {
      const isSettings = view === 'settings';
      elements.mainView.hidden = isSettings;
      elements.settingsView.hidden = !isSettings;
      elements.openSettingsButton.hidden = isSettings;
      document.body.classList.toggle('settings-open', isSettings);
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
      updateConstructionSequenceAvailability();
      updateProcessButton();
    }

    function resetSettings() {
      settings = clone(DEFAULT_SETTINGS);
      renderSettings(settings);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        for (const previousKey of PREVIOUS_STORAGE_KEYS) localStorage.removeItem(previousKey);
      } catch {}
      clearSettingsError();
      updateConstructionSequenceAvailability();
      updateProcessButton();
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
            psetPattern: mapping && mapping.psetPattern != null
              ? String(mapping.psetPattern)
              : DEFAULT_PROPERTY_PSET_PATTERN,
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

      if (typeof stored.addConstructionSequence === 'boolean') {
        base.addConstructionSequence = stored.addConstructionSequence;
      }

      return base;
    }

    function migrateCommonPropertyMappings(storedMappings) {
      const migrated = storedMappings.map((mapping) => {
        const psetPattern = String(mapping.psetPattern || DEFAULT_PROPERTY_PSET_PATTERN).trim()
          || DEFAULT_PROPERTY_PSET_PATTERN;
        const sourceName = String(mapping.sourceName || '').trim();
        const outputName = String(mapping.outputName || '').trim();
        if (sourceName.toLowerCase() === 'firerating' && outputName === 'Brandwerendheid') {
          return { psetPattern, sourceName, outputName: 'WBDBO' };
        }
        return { psetPattern, sourceName, outputName };
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

      elements.addConstructionSequenceInput.checked = value.addConstructionSequence === true;
    }

    function appendPropertyMappingRow(mapping, focusSource) {
      const row = document.createElement('div');
      row.className = 'property-mapping-row';
      row.setAttribute('data-property-mapping-row', '');
      row.innerHTML = `
        <div class="compact-field">
          <label>Set in het model</label>
          <input class="input" type="text" maxlength="255" spellcheck="false" data-mapping-pset value="${escapeHtml(mapping.psetPattern || DEFAULT_PROPERTY_PSET_PATTERN)}" placeholder="Pset_.*Common of Qto_.*BaseQuantities">
        </div>
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
        const input = row.querySelector('[data-mapping-pset]');
        if (input) input.focus();
      }
    }

    function appendClassificationAliasRow(alias, focusInput) {
      const row = document.createElement('div');
      row.className = 'classification-alias-row';
      row.setAttribute('data-classification-alias-row', '');
      row.innerHTML = `
        <div class="compact-field classification-alias-field">
          <input class="input" type="text" maxlength="255" spellcheck="false" data-classification-alias value="${escapeHtml(alias || '')}" placeholder="bijvoorbeeld Assembly Code" aria-label="Naam van classificatiemethode in het model">
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
          psetPattern: row.querySelector('[data-mapping-pset]').value.trim(),
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
        addConstructionSequence: elements.addConstructionSequenceInput.checked,
      };
    }

    function validateSettings(value) {
      const usedNames = new Set(['nl-sfb code', 'nl-sfb omschrijving', 'bouwvolgorde code', 'bouwvolgorde omschrijving']);

      for (const attribute of value.attributes) {
        if (!attribute.outputName) throw new Error('Geef iedere vaste IFC waarde een naam.');
        const normalized = attribute.outputName.toLowerCase();
        if (usedNames.has(normalized)) throw new Error(`De naam “${attribute.outputName}” wordt meer dan één keer gebruikt.`);
        usedNames.add(normalized);
      }

      for (const mapping of value.commonPropertyMappings) {
        if (!mapping.psetPattern || !mapping.sourceName || !mapping.outputName) {
          throw new Error('Vul bij iedere regel de Pset, eigenschap en naam in.');
        }
        compilePsetWildcard(mapping.psetPattern);
        const normalized = mapping.outputName.toLowerCase();
        if (usedNames.has(normalized)) throw new Error(`De naam “${mapping.outputName}” wordt meer dan één keer gebruikt.`);
        usedNames.add(normalized);
      }
    }

    function compilePsetWildcard(pattern) {
      const value = String(pattern || '').trim();
      if (!value) throw new Error('Vul bij iedere regel een Pset in.');
      const wildcardToken = '\u0000';
      const escaped = value
        .replace(/\.\*/g, wildcardToken)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(new RegExp(wildcardToken, 'g'), '.*');
      try {
        return new RegExp(`^(?:${escaped})$`, 'i');
      } catch (error) {
        throw new Error(`Het Pset patroon “${value}” is ongeldig.`);
      }
    }

    function setSelectedFiles(files) {
      if (isProcessing) return;
      clearMainError();
      const incoming = Array.from(files || []);
      if (!incoming.length) return;

      const invalidFiles = incoming.filter((file) => !file || !/\.ifc$/i.test(file.name));
      if (invalidFiles.length) {
        showMainError('Kies alleen bestanden met de extensie .ifc.');
        return;
      }

      selectedFiles = incoming;
      elements.ifcFileInput.value = '';
      resetResult();
      updateFileState();
    }

    function clearSelectedFiles() {
      if (isProcessing) return;
      selectedFiles = [];
      elements.ifcFileInput.value = '';
      resetResult();
      updateFileState();
    }

    function updateFileState() {
      const count = selectedFiles.length;
      const hasFiles = count > 0;
      elements.emptyFileState.hidden = hasFiles;
      elements.selectedFileState.hidden = !hasFiles;
      elements.selectedFileList.innerHTML = '';

      if (hasFiles) {
        const totalSize = selectedFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
        if (count === 1) {
          elements.selectedFileName.textContent = selectedFiles[0].name;
          elements.selectedFileMeta.textContent = `${formatBytes(totalSize)} · lokaal bestand`;
          elements.selectedFileList.hidden = true;
          elements.removeFileButton.textContent = 'Verwijderen';
        } else {
          elements.selectedFileName.textContent = `${count.toLocaleString('nl-NL')} IFC modellen geselecteerd`;
          elements.selectedFileMeta.textContent = `${formatBytes(totalSize)} · lokale bestanden`;
          elements.selectedFileList.hidden = false;
          elements.removeFileButton.textContent = 'Alles verwijderen';
          for (const file of selectedFiles) {
            const item = document.createElement('li');
            item.textContent = `${file.name} · ${formatBytes(file.size)}`;
            elements.selectedFileList.appendChild(item);
          }
        }
      }
      updateProcessButton();
    }

    function updateVisualName() {
      const value = elements.psetNameInput.value.trim() || 'Cpset_';
      elements.visualPsetName.textContent = value.length > 18 ? `${value.slice(0, 17)}…` : value;
    }

    function updateProcessButton() {
      elements.processButton.disabled = !selectedFiles.length || !elements.psetNameInput.value.trim() || !nlsfbReady || (settings.addConstructionSequence && !constructionSequenceReady) || isProcessing;
    }

    async function processSelectedIfc() {
      clearMainError();
      resetResult();

      try {
        if (!selectedFiles.length) throw new Error('Kies eerst één of meer IFC bestanden.');
        const targetPsetName = elements.psetNameInput.value.trim();
        if (!targetPsetName) throw new Error('Kies een naam voor jouw eigenschappen tabje.');

        validateSettings(settings);
        if (!nlsfbReady) throw new Error('De NL-SfB lijst is nog niet beschikbaar.');
        if (settings.addConstructionSequence && !constructionSequenceReady) {
          throw new Error('De bouwvolgorde kon niet worden geladen. Controleer of bouwvolgorde_nlsfb.json naast index.html staat.');
        }

        setBusy(true);
        updateProgress(0, 'Voorbereiden');
        elements.statusCard.hidden = false;

        const filesToProcess = [...selectedFiles];
        const results = [];
        const failures = [];

        for (let index = 0; index < filesToProcess.length; index += 1) {
          const file = filesToProcess[index];
          try {
            const result = await processIfcFile(file, index, filesToProcess.length, targetPsetName);
            results.push({ ...result, sourceFile: file });
          } catch (error) {
            failures.push({
              fileName: file.name,
              message: error && error.message ? error.message : String(error),
            });
          }
        }

        if (!results.length) {
          const firstFailure = failures[0];
          throw new Error(firstFailure ? `${firstFailure.fileName}: ${firstFailure.message}` : 'Geen van de IFC bestanden kon worden verwerkt.');
        }

        updateProgress(filesToProcess.length > 1 ? 98 : 100, filesToProcess.length > 1 ? 'Downloadbestand maken' : 'Gereed');
        await showResult(results, failures, filesToProcess.length);
      } catch (error) {
        elements.statusCard.hidden = true;
        showMainError(error.message || String(error));
      } finally {
        stopActiveWorker();
        setBusy(false);
      }
    }

    function processIfcFile(file, fileIndex, totalFiles, targetPsetName) {
      return new Promise((resolve, reject) => {
        const worker = new Worker('./worker.js');
        activeWorker = worker;
        let settled = false;

        const finish = () => {
          if (activeWorker === worker) activeWorker = null;
          worker.terminate();
        };

        worker.onmessage = (event) => {
          const message = event.data || {};
          if (message.type === 'progress') {
            const fileProgress = Math.max(0, Math.min(100, Number(message.percent) || 0));
            const overallProgress = ((fileIndex + fileProgress / 100) / totalFiles) * 100;
            const prefix = totalFiles > 1 ? `Model ${fileIndex + 1} van ${totalFiles} · ` : '';
            updateProgress(overallProgress, `${prefix}${message.message || ''}`);
            return;
          }

          if (message.type === 'error') {
            if (settled) return;
            settled = true;
            finish();
            reject(new Error(message.message || 'De IFC verwerking is mislukt.'));
            return;
          }

          if (message.type === 'done') {
            if (settled) return;
            settled = true;
            finish();
            resolve({
              blob: message.blob,
              summary: message.summary || {},
              report: message.report || {},
            });
          }
        };

        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          finish();
          reject(new Error(event.message || 'De verwerkingsmodule kon niet worden gestart.'));
        };

        worker.postMessage({
          type: 'process',
          file,
          config: {
            ...settings,
            targetPsetName,
            sourceFileName: file.name,
          },
          nlsfbEntries: activeNlsfbEntries,
          constructionSequenceConfig: settings.addConstructionSequence ? activeConstructionSequenceConfig : null,
        });
      });
    }

    function stopActiveWorker() {
      if (activeWorker) activeWorker.terminate();
      activeWorker = null;
    }

    function setBusy(busy) {
      isProcessing = busy;
      elements.processButton.disabled = busy || !selectedFiles.length || !elements.psetNameInput.value.trim() || !nlsfbReady || (settings.addConstructionSequence && !constructionSequenceReady);
      elements.psetNameInput.disabled = busy;
      elements.openSettingsButton.disabled = busy;
      elements.removeFileButton.disabled = busy;
      elements.ifcFileInput.disabled = busy;
      elements.dropzone.setAttribute('aria-disabled', busy ? 'true' : 'false');
      elements.processButtonLabel.textContent = busy ? 'Bezig met organiseren' : 'Organiseer IFC';
    }

    function updateProgress(percent, message) {
      const safePercent = Math.round(Math.max(0, Math.min(100, Number(percent) || 0)));
      elements.statusPercent.textContent = `${safePercent}%`;
      elements.progressBar.style.width = `${safePercent}%`;
      elements.statusMessage.textContent = message || '';
    }

    async function showResult(results, failures, totalSelectedFiles) {
      revokeOutputUrls();
      const multipleSelection = totalSelectedFiles > 1;
      const namedResults = assignUniqueOutputNames(results);
      let downloadBlob;
      let downloadName;

      if (multipleSelection) {
        updateProgress(98, 'Downloadbestand maken');
        downloadBlob = await createStoredZip(namedResults.map((result) => ({
          name: result.outputName,
          blob: result.blob,
        })));
        downloadName = 'organize-my-ifc-resultaten.zip';
        elements.resultTitle.textContent = 'Je IFC modellen zijn klaar';
        elements.downloadButtonLabel.textContent = 'Download ZIP';
        elements.resultFileDescription.textContent = `${downloadName} · ${namedResults.length.toLocaleString('nl-NL')} IFC bestanden · ${formatBytes(downloadBlob.size)}`;
      } else {
        const result = namedResults[0];
        downloadBlob = result.blob;
        downloadName = result.outputName;
        elements.resultTitle.textContent = 'Je IFC is klaar';
        elements.downloadButtonLabel.textContent = 'Download IFC';
        elements.resultFileDescription.textContent = `${downloadName} · ${formatBytes(downloadBlob.size)}`;
      }

      outputIfcUrl = URL.createObjectURL(downloadBlob);
      elements.downloadIfcLink.href = outputIfcUrl;
      elements.downloadIfcLink.download = downloadName;

      const summary = aggregateSummaries(namedResults.map((result) => result.summary));
      const resultParts = [];
      if (multipleSelection) {
        resultParts.push(`${namedResults.length.toLocaleString('nl-NL')} van ${totalSelectedFiles.toLocaleString('nl-NL')} modellen georganiseerd`);
      } else {
        resultParts.push(`${formatNumber(summary.processedElements)} elementen georganiseerd`);
      }
      resultParts.push(`${formatNumber(summary.propertiesAdded)} eigenschappen gebundeld`);
      if (Number(summary.sourceClassificationsFound || 0) > 0) {
        resultParts.push(`${formatNumber(summary.sourceClassificationsFound)} NL-SfB koppelingen gevonden`);
      }
      if (Number(summary.constructionSequenceAssignments || 0) > 0) {
        resultParts.push(`${formatNumber(summary.constructionSequenceAssignments)} bouwvolgordes toegevoegd`);
      }
      elements.resultSummary.textContent = resultParts.join(' · ');

      const report = aggregateReports(namedResults, failures);
      renderWarnings(report, summary);
      updateProgress(100, 'Gereed');
      elements.statusCard.hidden = true;
      elements.resultCard.hidden = false;
      elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function assignUniqueOutputNames(results) {
      const usedNames = new Set();
      return results.map((result) => {
        const originalName = String(result.sourceFile && result.sourceFile.name || 'model.ifc')
          .replace(/[\\/]+/g, '_');
        const preferredName = /\.ifc$/i.test(originalName) ? originalName : `${originalName}.ifc`;
        const baseName = preferredName.replace(/\.ifc$/i, '');
        let outputName = preferredName;
        let counter = 2;
        while (usedNames.has(outputName.toLocaleLowerCase('nl-NL'))) {
          outputName = `${baseName}_${counter}.ifc`;
          counter += 1;
        }
        usedNames.add(outputName.toLocaleLowerCase('nl-NL'));
        return { ...result, outputName };
      });
    }

    function aggregateSummaries(summaries) {
      const aggregate = {};
      for (const summary of summaries) {
        for (const [key, value] of Object.entries(summary || {})) {
          if (typeof value === 'number' && Number.isFinite(value)) {
            aggregate[key] = Number(aggregate[key] || 0) + value;
          }
        }
      }
      return aggregate;
    }

    function aggregateReports(results, failures) {
      const report = {
        warnings: [],
        unresolvedClassificationCodes: [],
        batchFailures: Array.isArray(failures) ? failures : [],
      };

      for (const result of results) {
        const fileName = result.sourceFile && result.sourceFile.name ? result.sourceFile.name : '';
        const sourceReport = result.report || {};
        for (const warning of Array.isArray(sourceReport.warnings) ? sourceReport.warnings : []) {
          report.warnings.push({ ...warning, fileName });
        }
        for (const code of Array.isArray(sourceReport.unresolvedClassificationCodes) ? sourceReport.unresolvedClassificationCodes : []) {
          report.unresolvedClassificationCodes.push({ code, fileName });
        }
      }
      return report;
    }

    function renderWarnings(report, summary) {
      const warnings = Array.isArray(report.warnings) ? report.warnings : [];
      const unresolved = Array.isArray(report.unresolvedClassificationCodes) ? report.unresolvedClassificationCodes : [];
      const failures = Array.isArray(report.batchFailures) ? report.batchFailures : [];
      const warningCount = Number(summary.warningCount || 0);
      const hasWarnings = warningCount > 0 || unresolved.length > 0 || failures.length > 0 || Number(summary.sourceDescriptionsMissing || 0) > 0;

      elements.warningNotice.hidden = !hasWarnings;
      elements.warningDetails.hidden = !hasWarnings;
      elements.warningList.innerHTML = '';

      if (!hasWarnings) return;

      const total = warningCount + unresolved.length + failures.length;
      const noticeText = failures.length
        ? 'Niet alle bestanden konden worden verwerkt. De beschikbare exports zijn wel gemaakt.'
        : 'De export is gemaakt, maar controleer de meldingen. Codes zonder match in de NL-SfB JSON krijgen de omschrijving “Onbekende NL-SfB codering”.';
      elements.warningNotice.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>
        <span>${noticeText}</span>
      `;
      elements.warningSummary.textContent = `${total.toLocaleString('nl-NL')} meldingen bekijken`;

      for (const failure of failures.slice(0, 100)) {
        const item = document.createElement('li');
        item.textContent = `${failure.fileName}: ${failure.message}`;
        elements.warningList.appendChild(item);
      }

      for (const entry of unresolved.slice(0, 100)) {
        const code = typeof entry === 'object' ? entry.code : entry;
        const fileName = typeof entry === 'object' ? entry.fileName : '';
        const item = document.createElement('li');
        item.textContent = `${fileName ? `${fileName}: ` : ''}Code “${code}” staat niet in de NL-SfB JSON en heeft de omschrijving “Onbekende NL-SfB codering” gekregen.`;
        elements.warningList.appendChild(item);
      }

      for (const warning of warnings.slice(0, 150)) {
        const item = document.createElement('li');
        const filePrefix = warning.fileName ? `${warning.fileName}: ` : '';
        item.textContent = `${filePrefix}${warning.expressId ? `#${warning.expressId}: ` : ''}${warning.message}`;
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

    async function createStoredZip(entries) {
      const encoder = new TextEncoder();
      const crcTable = createCrcTable();
      const localParts = [];
      const centralParts = [];
      let offset = 0;
      const now = new Date();
      const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
      const dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

      for (const entry of entries) {
        const blob = entry.blob;
        const size = Number(blob.size || 0);
        if (size > 0xFFFFFFFF) throw new Error('Een IFC bestand is te groot voor het ZIP formaat van deze app.');
        const safeName = String(entry.name || 'model.ifc').replace(/[\\/]+/g, '_');
        const nameBytes = encoder.encode(safeName);
        const crc = await crc32Blob(blob, crcTable);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        localView.setUint32(0, 0x04034B50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0x0800, true);
        localView.setUint16(8, 0, true);
        localView.setUint16(10, dosTime, true);
        localView.setUint16(12, dosDate, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, size, true);
        localView.setUint32(22, size, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);
        localParts.push(localHeader, blob);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        centralView.setUint32(0, 0x02014B50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0x0800, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, dosTime, true);
        centralView.setUint16(14, dosDate, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, size, true);
        centralView.setUint32(24, size, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true);
        centralView.setUint16(32, 0, true);
        centralView.setUint16(34, 0, true);
        centralView.setUint16(36, 0, true);
        centralView.setUint32(38, 0, true);
        centralView.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);
        centralParts.push(centralHeader);

        offset += localHeader.length + size;
      }

      const centralOffset = offset;
      const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
      const endRecord = new Uint8Array(22);
      const endView = new DataView(endRecord.buffer);
      endView.setUint32(0, 0x06054B50, true);
      endView.setUint16(4, 0, true);
      endView.setUint16(6, 0, true);
      endView.setUint16(8, entries.length, true);
      endView.setUint16(10, entries.length, true);
      endView.setUint32(12, centralSize, true);
      endView.setUint32(16, centralOffset, true);
      endView.setUint16(20, 0, true);

      return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
    }

    function createCrcTable() {
      const table = new Uint32Array(256);
      for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
          value = (value >>> 1) ^ ((value & 1) ? 0xEDB88320 : 0);
        }
        table[index] = value >>> 0;
      }
      return table;
    }

    async function crc32Blob(blob, table) {
      let crc = 0xFFFFFFFF;
      if (blob.stream && typeof blob.stream === 'function') {
        const reader = blob.stream().getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const byte of value) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF];
        }
      } else {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF];
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
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

    async function loadConstructionSequenceConfig() {
      const response = await fetch(CONSTRUCTION_SEQUENCE_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Bouwvolgordebestand kon niet worden geladen (${response.status}).`);
      const text = await response.text();
      const data = parseJsonTolerant(text);
      if (!data || !Array.isArray(data.fases) || !data.fases.length) {
        throw new Error('Veld “fases” ontbreekt in bouwvolgorde_nlsfb.json.');
      }
      return data;
    }

    function updateConstructionSequenceAvailability() {
      const isRequired = settings.addConstructionSequence === true;
      if (isRequired && constructionSequenceLoadError) {
        elements.dataError.textContent = 'De bouwvolgorde kon niet worden geladen. Controleer of bouwvolgorde_nlsfb.json naast index.html staat.';
        elements.dataError.hidden = false;
      } else if (nlsfbReady) {
        elements.dataError.hidden = true;
        elements.dataError.textContent = '';
      }
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
