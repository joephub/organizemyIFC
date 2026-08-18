'use strict';

const MAX_WARNINGS = 250;
const CLASSIFICATION_BATCH_SIZE = 4000;
const CANONICAL_CLASSIFICATION_NAME = 'NL-SfB tabel 1';
const TWO_DIGIT_CLASSIFICATION_NAME = 'NL-SfB tabel 1 (2 cijferig)';
const LEGACY_TWO_DIGIT_CLASSIFICATION_NAMES = ['NL-SfB tabel 1 - 2 cijferig'];
const UNKNOWN_NLSFB_DESCRIPTION = 'Onbekende NL-SfB codering';
const MISSING_NLSFB_CODE = 'XX';
const MISSING_NLSFB_DESCRIPTION = 'Geen NL-SfB codering';
const TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION = 'Geen of onbekende NL-SfB codering';
const CONSTRUCTION_SEQUENCE_CLASSIFICATION_NAME = 'Bouwvolgorde';
const DEFAULT_CONSTRUCTION_SEQUENCE_CODE_PROPERTY = 'Bouwvolgorde code';
const DEFAULT_CONSTRUCTION_SEQUENCE_DESCRIPTION_PROPERTY = 'Bouwvolgorde omschrijving';
const DEFAULT_CONSTRUCTION_SEQUENCE_MISSING_CODE = 'XX';
const DEFAULT_CONSTRUCTION_SEQUENCE_MISSING_DESCRIPTION = 'Geen bouwvolgorde omdat NL-SfB code ontbreekt';
const DEFAULT_CONSTRUCTION_SEQUENCE_UNMAPPED_CODE = 'NM';
const DEFAULT_CONSTRUCTION_SEQUENCE_UNMAPPED_DESCRIPTION = 'Geen bouwvolgorde ingesteld voor deze NL-SfB code';

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== 'process') return;

  try {
    const { file, config, nlsfbEntries, constructionSequenceConfig } = message;
    if (!file) throw new Error('Geen IFC bestand ontvangen.');

    postProgress(2, 'IFC bestand lezen');
    const text = await file.text();

    postProgress(8, 'IFC structuur analyseren');
    const result = processIfc(text, config || {}, nlsfbEntries || [], constructionSequenceConfig || null);

    postProgress(96, 'Exportbestand opbouwen');
    const blob = new Blob([result.output], { type: 'application/x-step' });

    postProgress(100, 'Gereed');
    self.postMessage({
      type: 'done',
      blob,
      summary: result.summary,
      report: result.report,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : '',
    });
  }
};

function postProgress(percent, message) {
  self.postMessage({ type: 'progress', percent, message });
}

function processIfc(text, config, nlsfbEntries, constructionSequenceConfig) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Het IFC bestand is leeg.');
  }

  const schema = detectSchema(text);
  if (!schema.supported) {
    throw new Error(`Niet ondersteund IFC schema: ${schema.raw || 'onbekend'}. Gebruik IFC2x3, IFC4 of IFC4x3.`);
  }

  const bounds = findDataSection(text);
  const dataText = text.slice(bounds.start, bounds.end);
  const parsed = parseEntities(dataText);
  const entities = parsed.entities;
  const entityList = parsed.list;

  if (!entityList.length) {
    throw new Error('Er zijn geen leesbare IFC STEP entiteiten gevonden.');
  }

  const maxId = findMaxExpressId(dataText);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const warnings = [];
  let totalWarningCount = 0;

  const addWarning = (code, message, expressId = null) => {
    totalWarningCount += 1;
    if (warnings.length < MAX_WARNINGS) warnings.push({ code, message, expressId });
  };

  postProgress(18, 'IFC relaties indexeren');
  const index = buildIndex(entityList, entities, schema.key, config, addWarning);

  const candidates = collectCandidateElements(index, entities, { includeOpenings: false });
  if (!candidates.length) {
    throw new Error('Er zijn geen geschikte IFC elementen gevonden.');
  }

  const nlsfb = buildNlsfbLookup(nlsfbEntries);
  const targetPsetName = normalizeTargetPsetName(config.targetPsetName || 'Cpset_');
  const attributeConfig = normalizeAttributeConfig(config.attributes || config.fields || []);
  const commonPropertyMappings = normalizeCommonPropertyMappings(config.commonPropertyMappings, config);
  const commonPsetRegex = compileCommonPsetRegex('^Pset_.*Common$');
  const classificationAliases = normalizeAliases(config.classificationAliases || []);
  const canonicalClassificationName = CANONICAL_CLASSIFICATION_NAME;
  const twoDigitClassificationName = TWO_DIGIT_CLASSIFICATION_NAME;
  const constructionSequence = config.addConstructionSequence === true
    ? normalizeConstructionSequenceConfig(constructionSequenceConfig)
    : null;
  const lengthUnitScaleToMillimetres = constructionSequence
    ? detectLengthUnitScaleToMillimetres(entityList, entities)
    : 1;
  const storeySequence = constructionSequence
    ? buildStoreySequence(
      entityList,
      entities,
      lengthUnitScaleToMillimetres,
      constructionSequence.settings,
    )
    : null;

  const classificationSystemIdsToNormalize = new Set();
  const twoDigitClassificationSystemIds = new Set();
  const constructionSequenceSystemIds = new Set();
  for (const [classificationId, classificationName] of index.classificationNames.entries()) {
    if (isTwoDigitClassificationName(classificationName)) {
      twoDigitClassificationSystemIds.add(classificationId);
    } else if (normalizeSearchText(classificationName) === normalizeSearchText(CONSTRUCTION_SEQUENCE_CLASSIFICATION_NAME)) {
      constructionSequenceSystemIds.add(classificationId);
    } else if (findAliasIndex(classificationName, classificationAliases) >= 0) {
      classificationSystemIdsToNormalize.add(classificationId);
    }
  }

  const summary = {
    schema: schema.display,
    schemaRaw: schema.raw,
    totalEntities: entityList.length,
    candidateElements: candidates.length,
    processedElements: 0,
    psetsAdded: 0,
    propertiesAdded: 0,
    skippedExistingTargetPset: 0,
    skippedWithoutValues: 0,
    sourceClassificationsFound: 0,
    sourceClassificationsMissing: 0,
    sourceDescriptionsMissing: 0,
    classificationSystemsNormalized: 0,
    twoDigitCodesFound: 0,
    twoDigitClassificationReferencesCreated: 0,
    twoDigitClassificationRelationsCreated: 0,
    twoDigitClassificationRelationsCleaned: 0,
    missingClassificationReferencesCreated: 0,
    missingClassificationRelationsCreated: 0,
    missingClassificationsAssigned: 0,
    classificationDescriptionsNormalized: 0,
    constructionSequenceAssignments: 0,
    constructionSequenceReferencesCreated: 0,
    constructionSequenceRelationsCreated: 0,
    constructionSequenceRelationsCleaned: 0,
    constructionSequenceUnmapped: 0,
    constructionSequenceWithoutStorey: 0,
    elementsWithoutStorey: 0,
    warningsShown: 0,
    warningCount: 0,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    schema: schema.display,
    sourceFile: config.sourceFileName || '',
    targetPsetName,
    settings: {
      commonPsetPattern: commonPsetRegex.source,
      classificationAliases,
      canonicalClassificationName,
      twoDigitClassificationName,
      addConstructionSequence: Boolean(constructionSequence),
      constructionSequenceClassificationName: constructionSequence ? CONSTRUCTION_SEQUENCE_CLASSIFICATION_NAME : null,
      constructionSequenceVersion: constructionSequence ? constructionSequence.metadata.version : null,
      constructionSequenceElevationUnit: constructionSequence ? 'mm' : null,
      constructionSequenceElevationSource: storeySequence ? storeySequence.elevationSource : null,
      constructionSequenceElevationRoundingMm: storeySequence ? storeySequence.elevationRoundingMm : null,
    },
    unresolvedClassificationCodes: [],
    duplicateClassificationCandidates: [],
    warnings,
  };

  const unresolvedCodeSet = new Set();
  const duplicateClassSet = new Set();
  const elementRecords = [];
  const twoDigitAssignments = new Map();
  const desiredTwoDigitCodeByElement = new Map();
  const constructionSequenceAssignments = new Map();
  const desiredConstructionSequenceCodeByElement = new Map();
  const constructionSequenceDescriptionsByCode = new Map();
  const missingClassificationElementIds = [];

  postProgress(30, 'Elementinformatie verzamelen');
  const progressStep = Math.max(1, Math.floor(candidates.length / 20));

  for (let position = 0; position < candidates.length; position += 1) {
    const expressId = candidates[position];
    const entity = entities.get(expressId);
    if (!entity) continue;
    const hasGeometry = hasGeometricRepresentation(entity, entities);

    if (position % progressStep === 0) {
      const progress = 30 + Math.floor((position / candidates.length) * 38);
      postProgress(Math.min(68, progress), `Elementen analyseren: ${position.toLocaleString('nl-NL')} van ${candidates.length.toLocaleString('nl-NL')}`);
    }

    const typeId = index.typeByObject.get(expressId) || null;
    const typeEntity = typeId ? entities.get(typeId) : null;
    let storeyId = findStoreyForObject(expressId, index, entities);
    if (!storeyId && storeySequence) {
      storeyId = findStoreyByObjectPlacement(entity, storeySequence, entities);
    }
    const storeyInfo = storeyId && storeySequence ? storeySequence.byId.get(storeyId) || null : null;
    const storeyName = storeyId ? getStringArg(entities.get(storeyId), 2) : null;
    if (!storeyId) summary.elementsWithoutStorey += 1;

    const commonProperties = collectCommonProperties(
      expressId,
      typeId,
      index,
      entities,
      commonPsetRegex,
      config,
    );

    const classificationResult = findMatchingClassification(
      expressId,
      typeId,
      index,
      entities,
      classificationAliases,
      true,
    );

    let sourceCode = null;
    let sourceDescription = null;
    let twoDigitCode = null;
    let twoDigitDescription = null;
    let twoDigitUri = null;
    let canonicalSourceCode = null;
    let sourceCodeIsValid = false;

    if (classificationResult.match) {
      summary.sourceClassificationsFound += 1;
      sourceCode = classificationResult.match.code;
      if (classificationResult.match.systemId) {
        classificationSystemIdsToNormalize.add(classificationResult.match.systemId);
      }

      if (classificationResult.matches.length > 1) {
        const duplicateKey = `${expressId}:${classificationResult.matches.map((item) => item.referenceId).join(',')}`;
        if (!duplicateClassSet.has(duplicateKey)) {
          duplicateClassSet.add(duplicateKey);
          report.duplicateClassificationCandidates.push({
            expressId,
            selectedReference: classificationResult.match.referenceId,
            candidates: classificationResult.matches.map((item) => ({
              referenceId: item.referenceId,
              systemName: item.systemName,
              code: item.code,
              inheritedFromType: item.inheritedFromType,
            })),
          });
        }
      }

      const rawSourceCode = String(sourceCode || '').trim();
      canonicalSourceCode = canonicalizeClassificationCode(sourceCode, nlsfb.byCode);
      const officialSource = canonicalSourceCode ? nlsfb.byCode.get(canonicalSourceCode) : null;
      if (rawSourceCode.toUpperCase() === MISSING_NLSFB_CODE) {
        sourceDescription = MISSING_NLSFB_DESCRIPTION;
        twoDigitCode = MISSING_NLSFB_CODE;
        twoDigitDescription = TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION;
      } else if (officialSource) {
        sourceCodeIsValid = true;
        sourceDescription = officialSource.name;

        const derivedCode = deriveTwoDigitCode(sourceCode);
        if (derivedCode) {
          const officialTwoDigit = nlsfb.byCode.get(derivedCode);
          if (officialTwoDigit) {
            twoDigitCode = derivedCode;
            twoDigitDescription = officialTwoDigit.name;
            twoDigitUri = officialTwoDigit.uri;
          } else {
            twoDigitCode = MISSING_NLSFB_CODE;
            twoDigitDescription = TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION;
            addWarning('NLSFB_TWO_DIGIT_NOT_FOUND', `Tweecijferige NL-SfB code ${derivedCode} staat niet in de geladen JSON.`, expressId);
          }
        }
      } else {
        sourceDescription = UNKNOWN_NLSFB_DESCRIPTION;
        twoDigitCode = MISSING_NLSFB_CODE;
        twoDigitDescription = TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION;
        summary.sourceDescriptionsMissing += 1;
        const key = rawSourceCode;
        if (key && !unresolvedCodeSet.has(key)) {
          unresolvedCodeSet.add(key);
          report.unresolvedClassificationCodes.push(key);
        }
      }
    } else {
      summary.sourceClassificationsMissing += 1;
      if (hasGeometry) {
        sourceCode = MISSING_NLSFB_CODE;
        sourceDescription = MISSING_NLSFB_DESCRIPTION;
        twoDigitCode = MISSING_NLSFB_CODE;
        twoDigitDescription = TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION;
        missingClassificationElementIds.push(expressId);
        summary.missingClassificationsAssigned += 1;
      }
    }

    const values = {
      storey: storeyName,
      name: getStringArg(entity, 2),
      typeName: typeEntity ? getStringArg(typeEntity, 2) : null,
      ifcEntity: formatIfcEntityName(entity.type),
      predefinedType: extractPredefinedType(entity, typeEntity, schema.key),
      objectType: getStringArg(entity, 4),
    };

    if (twoDigitCode) {
      summary.twoDigitCodesFound += 1;
      desiredTwoDigitCodeByElement.set(expressId, twoDigitCode);
      if (!twoDigitAssignments.has(twoDigitCode)) {
        twoDigitAssignments.set(twoDigitCode, {
          code: twoDigitCode,
          name: twoDigitDescription,
          uri: twoDigitUri,
          elementIds: [],
        });
      }
      twoDigitAssignments.get(twoDigitCode).elementIds.push(expressId);
    }

    let constructionAssignment = null;
    if (constructionSequence && hasGeometry) {
      constructionAssignment = resolveConstructionSequenceAssignment({
        sourceCode,
        canonicalSourceCode,
        sourceCodeIsValid,
        storeyInfo,
        storeySequence,
        commonProperties,
        constructionSequence,
      });

      summary.constructionSequenceAssignments += 1;
      if (constructionAssignment.kind !== 'mapped') summary.constructionSequenceUnmapped += 1;
      if (!storeyInfo) summary.constructionSequenceWithoutStorey += 1;

      desiredConstructionSequenceCodeByElement.set(expressId, constructionAssignment.code);
      constructionSequenceDescriptionsByCode.set(constructionAssignment.code, constructionAssignment.description);
      if (!constructionSequenceAssignments.has(constructionAssignment.code)) {
        constructionSequenceAssignments.set(constructionAssignment.code, {
          code: constructionAssignment.code,
          name: constructionAssignment.description,
          elementIds: [],
        });
      }
      constructionSequenceAssignments.get(constructionAssignment.code).elementIds.push(expressId);
    }

    const targetAlreadyExists = hasDirectPsetNamed(expressId, targetPsetName, index, entities);
    if (targetAlreadyExists) {
      summary.skippedExistingTargetPset += 1;
      continue;
    }

    const propertyCandidates = [];
    for (const attribute of attributeConfig) {
      propertyCandidates.push({
        name: attribute.outputName,
        type: attribute.type,
        value: values[attribute.key],
      });
    }

    for (const mapping of commonPropertyMappings) {
      propertyCandidates.push({
        name: mapping.outputName,
        type: mapping.type,
        value: getMapValue(commonProperties, normalizeKey(mapping.sourceName)),
      });
    }

    propertyCandidates.push({ name: 'NL-SfB code', type: 'identifier', value: sourceCode });
    propertyCandidates.push({ name: 'NL-SfB omschrijving', type: 'label', value: sourceDescription });

    if (constructionAssignment) {
      propertyCandidates.push({
        name: constructionSequence.settings.codePropertyName,
        type: 'identifier',
        value: constructionAssignment.code,
      });
      propertyCandidates.push({
        name: constructionSequence.settings.descriptionPropertyName,
        type: 'label',
        value: constructionAssignment.description,
      });
    }

    const properties = buildTargetProperties(propertyCandidates, addWarning, expressId);
    if (!properties.length) {
      summary.skippedWithoutValues += 1;
      continue;
    }

    elementRecords.push({
      expressId,
      properties,
    });
  }

  postProgress(70, 'Eigenschappen bundelen');
  let nextId = maxId + 1;
  const newLines = [];
  const newEntityIds = new Set();
  const ownerHistoryId = index.ownerHistoryId;
  const ownerHistoryRef = ownerHistoryId ? `#${ownerHistoryId}` : '$';

  const addEntity = (type, args) => {
    const id = nextId;
    nextId += 1;
    newEntityIds.add(id);
    newLines.push(`#${id}=${type}(${args});`);
    return id;
  };

  const totalRecords = elementRecords.length;
  const writeProgressStep = Math.max(1, Math.floor(totalRecords / 15));

  for (let position = 0; position < totalRecords; position += 1) {
    const record = elementRecords[position];

    if (position % writeProgressStep === 0) {
      const progress = 70 + Math.floor((position / Math.max(1, totalRecords)) * 14);
      postProgress(Math.min(84, progress), `Eigenschappen bundelen: ${position.toLocaleString('nl-NL')} van ${totalRecords.toLocaleString('nl-NL')}`);
    }

    const propertyIds = [];
    for (const property of record.properties) {
      const nominalValue = serializeNominalValue(property.type, property.value);
      const propertyId = addEntity(
        'IFCPROPERTYSINGLEVALUE',
        `${encodeStepString(property.name)},$,${nominalValue},$`,
      );
      propertyIds.push(propertyId);
      summary.propertiesAdded += 1;
    }

    const psetId = addEntity(
      'IFCPROPERTYSET',
      `${encodeStepString(createIfcGuid())},${ownerHistoryRef},${encodeStepString(targetPsetName)},$,(${propertyIds.map((id) => `#${id}`).join(',')})`,
    );

    addEntity(
      'IFCRELDEFINESBYPROPERTIES',
      `${encodeStepString(createIfcGuid())},${ownerHistoryRef},$,$,(#${record.expressId}),#${psetId}`,
    );

    summary.psetsAdded += 1;
    summary.processedElements += 1;
  }

  if (missingClassificationElementIds.length > 0) {
    postProgress(85, 'Ontbrekende NL-SfB coderingen markeren');
    let classificationId = selectPrimaryClassificationSystemId(
      index,
      classificationSystemIdsToNormalize,
      canonicalClassificationName,
    );

    if (!classificationId) {
      classificationId = addClassificationEntity(
        addEntity,
        schema.key,
        canonicalClassificationName,
      );
    }

    const existingRefs = findClassificationReferencesForSource(classificationId, entityList, entities);
    let referenceId = existingRefs.get(MISSING_NLSFB_CODE) || null;
    if (!referenceId) {
      referenceId = addClassificationReferenceEntity(
        addEntity,
        schema.key,
        classificationId,
        MISSING_NLSFB_CODE,
        MISSING_NLSFB_DESCRIPTION,
        null,
      );
      summary.missingClassificationReferencesCreated += 1;
    }

    const uniqueIds = Array.from(new Set(missingClassificationElementIds))
      .filter((objectId) => !hasDirectClassificationReference(objectId, referenceId, index));
    for (let start = 0; start < uniqueIds.length; start += CLASSIFICATION_BATCH_SIZE) {
      const batch = uniqueIds.slice(start, start + CLASSIFICATION_BATCH_SIZE);
      addEntity(
        'IFCRELASSOCIATESCLASSIFICATION',
        `${encodeStepString(createIfcGuid())},${ownerHistoryRef},$,$,(${batch.map((id) => `#${id}`).join(',')}),#${referenceId}`,
      );
      summary.missingClassificationRelationsCreated += 1;
    }
  }

  if (twoDigitAssignments.size > 0) {
    postProgress(87, 'NL-SfB indeling aanvullen');
    let classificationId = findClassificationByNames(
      [twoDigitClassificationName, ...LEGACY_TWO_DIGIT_CLASSIFICATION_NAMES],
      entityList,
    );

    if (!classificationId) {
      classificationId = addClassificationEntity(
        addEntity,
        schema.key,
        twoDigitClassificationName,
      );
    } else {
      twoDigitClassificationSystemIds.add(classificationId);
    }

    const existingRefs = findClassificationReferencesForSource(classificationId, entityList, entities);

    for (const assignment of twoDigitAssignments.values()) {
      let referenceId = existingRefs.get(assignment.code) || null;
      if (!referenceId) {
        referenceId = addClassificationReferenceEntity(
          addEntity,
          schema.key,
          classificationId,
          assignment.code,
          formatTwoDigitReferenceName(assignment.code, assignment.name),
          assignment.uri,
        );
        summary.twoDigitClassificationReferencesCreated += 1;
      }

      const uniqueIds = Array.from(new Set(assignment.elementIds))
        .filter((objectId) => !hasDirectClassificationReference(objectId, referenceId, index));
      for (let start = 0; start < uniqueIds.length; start += CLASSIFICATION_BATCH_SIZE) {
        const batch = uniqueIds.slice(start, start + CLASSIFICATION_BATCH_SIZE);
        addEntity(
          'IFCRELASSOCIATESCLASSIFICATION',
          `${encodeStepString(createIfcGuid())},${ownerHistoryRef},$,$,(${batch.map((id) => `#${id}`).join(',')}),#${referenceId}`,
        );
        summary.twoDigitClassificationRelationsCreated += 1;
      }
    }
  }


  if (constructionSequence && constructionSequenceAssignments.size > 0) {
    postProgress(89, 'Bouwvolgorde toevoegen');
    let classificationId = findClassificationByNames(
      [CONSTRUCTION_SEQUENCE_CLASSIFICATION_NAME],
      entityList,
    );

    if (!classificationId) {
      classificationId = addConstructionSequenceClassificationEntity(
        addEntity,
        schema.key,
        constructionSequence.metadata.version,
      );
    } else {
      constructionSequenceSystemIds.add(classificationId);
    }

    const existingRefs = findClassificationReferencesForSource(classificationId, entityList, entities);

    for (const assignment of constructionSequenceAssignments.values()) {
      let referenceId = existingRefs.get(assignment.code) || null;
      if (!referenceId) {
        referenceId = addClassificationReferenceEntity(
          addEntity,
          schema.key,
          classificationId,
          assignment.code,
          assignment.name,
          null,
        );
        summary.constructionSequenceReferencesCreated += 1;
      }

      const uniqueIds = Array.from(new Set(assignment.elementIds))
        .filter((objectId) => !hasDirectClassificationReference(objectId, referenceId, index));
      for (let start = 0; start < uniqueIds.length; start += CLASSIFICATION_BATCH_SIZE) {
        const batch = uniqueIds.slice(start, start + CLASSIFICATION_BATCH_SIZE);
        addEntity(
          'IFCRELASSOCIATESCLASSIFICATION',
          `${encodeStepString(createIfcGuid())},${ownerHistoryRef},$,$,(${batch.map((id) => `#${id}`).join(',')}),#${referenceId}`,
        );
        summary.constructionSequenceRelationsCreated += 1;
      }
    }
  }

  const rewritten = rewriteClassificationMetadata(
    dataText,
    entities,
    index,
    classificationSystemIdsToNormalize,
    twoDigitClassificationSystemIds,
    desiredTwoDigitCodeByElement,
    constructionSequenceSystemIds,
    desiredConstructionSequenceCodeByElement,
    constructionSequenceDescriptionsByCode,
    nlsfb,
    canonicalClassificationName,
    twoDigitClassificationName,
    CONSTRUCTION_SEQUENCE_CLASSIFICATION_NAME,
  );
  summary.classificationSystemsNormalized = rewritten.systemNamesChangedCount;
  summary.classificationDescriptionsNormalized = rewritten.referenceNamesChangedCount;
  summary.twoDigitClassificationRelationsCleaned = rewritten.twoDigitRelationsCleanedCount;
  summary.constructionSequenceRelationsCleaned = rewritten.constructionSequenceRelationsCleanedCount;

  if (!newLines.length && rewritten.changedCount === 0) {
    throw new Error('Er is geen nieuwe informatie gevonden om te structureren.');
  }

  if (newLines.length) {
    validateNewLines(newLines, maxId, newEntityIds, entities, addWarning);
  }

  const insertion = newLines.length
    ? `${newline}/* IFC informatie gegroepeerd door Organize my IFC */${newline}${newLines.join(newline)}${newline}`
    : '';
  const output = `${text.slice(0, bounds.start)}${rewritten.text}${insertion}${text.slice(bounds.end)}`;

  summary.warningCount = totalWarningCount;
  summary.warningsShown = warnings.length;
  report.warnings = warnings;
  report.summary = summary;

  return { output, summary, report };
}

function detectSchema(text) {
  const match = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  const raw = match ? match[1].trim().toUpperCase() : '';
  if (raw.includes('IFC2X3')) return { raw, key: 'IFC2X3', display: 'IFC 2x3', supported: true };
  if (raw.includes('IFC4X3')) return { raw, key: 'IFC4X3', display: 'IFC 4x3', supported: true };
  if (raw.startsWith('IFC4')) return { raw, key: 'IFC4', display: 'IFC 4', supported: true };
  return { raw, key: raw || 'UNKNOWN', display: raw || 'Onbekend', supported: false };
}

function findDataSection(text) {
  const upper = text.toUpperCase();
  const dataMarker = upper.indexOf('DATA;');
  if (dataMarker < 0) throw new Error('Geen DATA sectie gevonden in het IFC STEP bestand.');
  const start = dataMarker + 5;
  const end = upper.indexOf('ENDSEC;', start);
  if (end < 0) throw new Error('De IFC DATA sectie is niet correct afgesloten.');
  return { start, end };
}

function findMaxExpressId(dataText) {
  const regex = /#\s*(\d+)\s*=/g;
  let max = 0;
  let match;
  while ((match = regex.exec(dataText)) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

function parseEntities(dataText) {
  const entities = new Map();
  const list = [];
  let index = 0;
  const length = dataText.length;

  while (index < length) {
    index = skipWhitespaceAndComments(dataText, index);
    if (index >= length) break;

    if (dataText[index] !== '#') {
      index += 1;
      continue;
    }

    const statementStart = index;
    let inString = false;
    let inComment = false;
    let depth = 0;
    let foundEnd = false;

    for (; index < length; index += 1) {
      const char = dataText[index];
      const next = dataText[index + 1];

      if (inComment) {
        if (char === '*' && next === '/') {
          inComment = false;
          index += 1;
        }
        continue;
      }

      if (!inString && char === '/' && next === '*') {
        inComment = true;
        index += 1;
        continue;
      }

      if (char === "'") {
        if (inString && next === "'") {
          index += 1;
          continue;
        }
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '(') depth += 1;
        else if (char === ')') depth = Math.max(0, depth - 1);
        else if (char === ';' && depth === 0) {
          index += 1;
          foundEnd = true;
          break;
        }
      }
    }

    if (!foundEnd) break;
    const statement = dataText.slice(statementStart, index);
    const entity = parseEntityStatement(statement);
    if (entity) {
      entity.start = statementStart;
      entity.end = index;
      entity.statement = statement;
      entities.set(entity.id, entity);
      list.push(entity);
    }
  }

  return { entities, list };
}

function skipWhitespaceAndComments(text, start) {
  let index = start;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      index += 1;
      continue;
    }
    if (text[index] === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

function parseEntityStatement(statement) {
  const clean = removeStepComments(statement).trim();
  const match = clean.match(/^#\s*(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*;$/i);
  if (!match) return null;

  const id = Number(match[1]);
  const type = match[2].toUpperCase();
  const argsRaw = match[3];
  const rawArgs = splitTopLevel(argsRaw);
  const args = rawArgs.map(parseStepValue);

  return { id, type, args, rawArgs };
}

function removeStepComments(text) {
  let output = '';
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "'") {
      output += char;
      if (inString && next === "'") {
        output += next;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (!inString && char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      if (end < 0) break;
      index = end + 1;
      continue;
    }

    output += char;
  }
  return output;
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "'") {
      if (inString && next === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }

  const finalPart = text.slice(start).trim();
  if (finalPart || text.trim()) parts.push(finalPart);
  return parts;
}

function parseStepValue(raw) {
  const value = String(raw || '').trim();
  if (value === '$') return { kind: 'null', raw: value };
  if (value === '*') return { kind: 'derived', raw: value };

  const refMatch = value.match(/^#\s*(\d+)$/);
  if (refMatch) return { kind: 'ref', value: Number(refMatch[1]), raw: value };

  if (value.startsWith('(') && value.endsWith(')') && hasBalancedOuterParentheses(value)) {
    const inner = value.slice(1, -1);
    return { kind: 'list', value: splitTopLevel(inner).map(parseStepValue), raw: value };
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return { kind: 'string', value: decodeStepString(value), raw: value };
  }

  const enumMatch = value.match(/^\.([A-Z0-9_]+)\.$/i);
  if (enumMatch) {
    const enumValue = enumMatch[1].toUpperCase();
    if (enumValue === 'T') return { kind: 'boolean', value: true, raw: value };
    if (enumValue === 'F') return { kind: 'boolean', value: false, raw: value };
    if (enumValue === 'U') return { kind: 'logical', value: null, raw: value };
    return { kind: 'enum', value: enumValue, raw: value };
  }

  const typedMatch = value.match(/^([A-Z][A-Z0-9_]*)\s*\(([\s\S]*)\)$/i);
  if (typedMatch && hasBalancedCall(value)) {
    return {
      kind: 'typed',
      type: typedMatch[1].toUpperCase(),
      value: parseStepValue(typedMatch[2]),
      raw: value,
    };
  }

  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?$/i.test(value)) {
    return { kind: 'number', value: Number(value), raw: value };
  }

  return { kind: 'raw', value, raw: value };
}

function hasBalancedOuterParentheses(value) {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === "'") {
      if (inString && next === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) continue;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function hasBalancedCall(value) {
  const firstParen = value.indexOf('(');
  if (firstParen < 1 || !value.endsWith(')')) return false;
  return hasBalancedOuterParentheses(value.slice(firstParen));
}

function decodeStepString(raw) {
  let value = raw.slice(1, -1).replace(/''/g, "'");

  value = value.replace(/\\X4\\([0-9A-F]+)\\X0\\/gi, (_, hex) => {
    let output = '';
    for (let index = 0; index + 7 < hex.length; index += 8) {
      const codePoint = Number.parseInt(hex.slice(index, index + 8), 16);
      if (Number.isFinite(codePoint)) output += String.fromCodePoint(codePoint);
    }
    return output;
  });

  value = value.replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, hex) => {
    let output = '';
    for (let index = 0; index + 3 < hex.length; index += 4) {
      const codeUnit = Number.parseInt(hex.slice(index, index + 4), 16);
      if (Number.isFinite(codeUnit)) output += String.fromCharCode(codeUnit);
    }
    return output;
  });

  value = value.replace(/\\X\\([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  value = value.replace(/\\S\\(.)/g, (_, char) => String.fromCharCode(char.charCodeAt(0) + 128));
  value = value.replace(/\\P[A-I]\\/gi, '');
  return value;
}

function encodeStepString(input) {
  const value = String(input == null ? '' : input);
  let output = "'";
  let unicodeBuffer = '';

  const flushUnicode = () => {
    if (!unicodeBuffer) return;
    output += `\\X2\\${unicodeBuffer}\\X0\\`;
    unicodeBuffer = '';
  };

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const char = value[index];
    const isSafeAscii = codeUnit >= 32 && codeUnit <= 126 && char !== '\\';

    if (isSafeAscii) {
      flushUnicode();
      output += char === "'" ? "''" : char;
    } else {
      unicodeBuffer += codeUnit.toString(16).toUpperCase().padStart(4, '0');
    }
  }

  flushUnicode();
  output += "'";
  return output;
}

function buildIndex(entityList, entities, schemaKey, config, addWarning) {
  const containmentByObject = new Map();
  const referencedSpatialByObject = new Map();
  const parentByChild = new Map();
  const childrenByParent = new Map();
  const typeByObject = new Map();
  const directPsetsByObject = new Map();
  const directClassificationsByObject = new Map();
  const psetProperties = new Map();
  const psetNameById = new Map();
  const classificationRefs = new Map();
  const classificationNames = new Map();
  let ownerHistoryId = null;

  for (const entity of entityList) {
    if (!ownerHistoryId && entity.type === 'IFCOWNERHISTORY') ownerHistoryId = entity.id;

    if (entity.type === 'IFCPROPERTYSET') {
      psetNameById.set(entity.id, getStringArg(entity, 2) || '');
      psetProperties.set(entity.id, getRefIds(entity.args[4]));
      continue;
    }

    if (entity.type === 'IFCCLASSIFICATION') {
      classificationNames.set(entity.id, getStringArg(entity, 3) || '');
      continue;
    }

    if (entity.type === 'IFCCLASSIFICATIONREFERENCE') {
      classificationRefs.set(entity.id, {
        id: entity.id,
        code: getStringArg(entity, 1),
        name: getStringArg(entity, 2),
        sourceId: getSingleRef(entity.args[3]),
      });
      continue;
    }
  }

  for (const entity of entityList) {
    switch (entity.type) {
      case 'IFCRELCONTAINEDINSPATIALSTRUCTURE': {
        const objects = getRefIds(entity.args[4]);
        const spatial = getSingleRef(entity.args[5]);
        if (spatial) {
          for (const objectId of objects) containmentByObject.set(objectId, spatial);
        }
        break;
      }

      case 'IFCRELREFERENCEDINSPATIALSTRUCTURE': {
        const objects = getRefIds(entity.args[4]);
        const spatial = getSingleRef(entity.args[5]);
        if (spatial) {
          for (const objectId of objects) referencedSpatialByObject.set(objectId, spatial);
        }
        break;
      }

      case 'IFCRELAGGREGATES':
      case 'IFCRELNESTS': {
        const parent = getSingleRef(entity.args[4]);
        const children = getRefIds(entity.args[5]);
        if (parent) {
          if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
          for (const child of children) {
            if (!parentByChild.has(child)) parentByChild.set(child, parent);
            childrenByParent.get(parent).push(child);
          }
        }
        break;
      }

      case 'IFCRELDEFINESBYTYPE': {
        const objects = getRefIds(entity.args[4]);
        const typeId = getSingleRef(entity.args[5]);
        if (typeId) {
          for (const objectId of objects) typeByObject.set(objectId, typeId);
        }
        break;
      }

      case 'IFCRELDEFINESBYPROPERTIES': {
        const objects = getRefIds(entity.args[4]);
        const psetIds = getRefIds(entity.args[5]);
        for (const objectId of objects) {
          if (!directPsetsByObject.has(objectId)) directPsetsByObject.set(objectId, []);
          directPsetsByObject.get(objectId).push(...psetIds);
        }
        break;
      }

      case 'IFCRELASSOCIATESCLASSIFICATION': {
        const objects = getRefIds(entity.args[4]);
        const classificationId = getSingleRef(entity.args[5]);
        if (classificationId) {
          for (const objectId of objects) {
            if (!directClassificationsByObject.has(objectId)) directClassificationsByObject.set(objectId, []);
            directClassificationsByObject.get(objectId).push(classificationId);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  for (const typeId of new Set(typeByObject.values())) {
    const typeEntity = entities.get(typeId);
    if (!typeEntity) continue;
    const directTypePsets = [];

    if (typeEntity.args[5]) {
      directTypePsets.push(...getRefIds(typeEntity.args[5]).filter((id) => entities.get(id)?.type === 'IFCPROPERTYSET'));
    }

    for (const arg of typeEntity.args) {
      for (const id of getRefIds(arg)) {
        if (entities.get(id)?.type === 'IFCPROPERTYSET') directTypePsets.push(id);
      }
    }

    if (directTypePsets.length) {
      const current = directPsetsByObject.get(typeId) || [];
      directPsetsByObject.set(typeId, Array.from(new Set([...current, ...directTypePsets])));
    }
  }

  if (schemaKey === 'IFC2X3' && !ownerHistoryId) {
    addWarning('OWNER_HISTORY_MISSING', 'IFC2x3 bevat geen IfcOwnerHistory. Nieuwe rootentiteiten krijgen een lege OwnerHistory verwijzing.');
  }

  return {
    containmentByObject,
    referencedSpatialByObject,
    parentByChild,
    childrenByParent,
    typeByObject,
    directPsetsByObject,
    directClassificationsByObject,
    psetProperties,
    psetNameById,
    classificationRefs,
    classificationNames,
    ownerHistoryId,
  };
}

function collectCandidateElements(index, entities, config) {
  const candidates = new Set();
  for (const objectId of index.containmentByObject.keys()) candidates.add(objectId);
  for (const objectId of index.referencedSpatialByObject.keys()) candidates.add(objectId);

  const queue = Array.from(candidates);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parent = queue[cursor];
    const children = index.childrenByParent.get(parent) || [];
    for (const child of children) {
      if (!candidates.has(child)) {
        candidates.add(child);
        queue.push(child);
      }
    }
  }

  for (const entity of entities.values()) {
    if (isTargetElement(entity, config) && hasGeometricRepresentation(entity, entities)) {
      candidates.add(entity.id);
    }
  }

  return Array.from(candidates)
    .filter((id) => isTargetElement(entities.get(id), config))
    .sort((a, b) => a - b);
}

function hasGeometricRepresentation(entity, entities) {
  if (!entity || !Array.isArray(entity.args) || entity.args.length <= 6) return false;
  const representationIds = getRefIds(entity.args[6]);
  if (!representationIds.length) return false;

  return representationIds.some((representationId) => {
    const representation = entities.get(representationId);
    if (!representation) return false;
    return representation.type === 'IFCPRODUCTDEFINITIONSHAPE'
      || representation.type === 'IFCPRODUCTREPRESENTATION'
      || representation.type === 'IFCSHAPEREPRESENTATION'
      || representation.type.endsWith('REPRESENTATION');
  });
}

function isTargetElement(entity, config) {
  if (!entity) return false;
  const type = entity.type;
  if (!type.startsWith('IFC')) return false;
  if (type.startsWith('IFCREL')) return false;
  if (type.endsWith('TYPE') || type.endsWith('STYLE')) return false;

  const excluded = new Set([
    'IFCPROJECT',
    'IFCPROJECTLIBRARY',
    'IFCSITE',
    'IFCBUILDING',
    'IFCBUILDINGSTOREY',
    'IFCSPACE',
    'IFCSPATIALZONE',
    'IFCZONE',
    'IFCGROUP',
    'IFCSYSTEM',
    'IFCDISTRIBUTIONSYSTEM',
    'IFCGRID',
    'IFCANNOTATION',
    'IFCPORT',
    'IFCDISTRIBUTIONPORT',
    'IFCVIRTUALELEMENT',
  ]);

  if (excluded.has(type)) return false;

  if (config.includeOpenings !== true) {
    if (type === 'IFCOPENINGELEMENT' || type.includes('FEATUREELEMENTSUBTRACTION')) return false;
  }

  return true;
}

function findStoreyForObject(objectId, index, entities) {
  const visited = new Set();
  let current = objectId;

  for (let depth = 0; depth < 60 && current; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);

    const entity = entities.get(current);
    if (entity?.type === 'IFCBUILDINGSTOREY') return current;

    const spatial = index.containmentByObject.get(current) || index.referencedSpatialByObject.get(current);
    if (spatial) {
      const storey = climbToStorey(spatial, index, entities, visited);
      if (storey) return storey;
    }

    current = index.parentByChild.get(current) || null;
  }

  return null;
}

function climbToStorey(startId, index, entities, externalVisited) {
  const visited = new Set(externalVisited || []);
  let current = startId;
  for (let depth = 0; depth < 60 && current; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const entity = entities.get(current);
    if (entity?.type === 'IFCBUILDINGSTOREY') return current;
    current = index.parentByChild.get(current) || null;
  }
  return null;
}


function buildStoreySequence(
  entityList,
  entities,
  lengthUnitScaleToMillimetres = 1,
  constructionSettings = {},
) {
  const scaleToMillimetres = Number.isFinite(Number(lengthUnitScaleToMillimetres))
    && Number(lengthUnitScaleToMillimetres) > 0
    ? Number(lengthUnitScaleToMillimetres)
    : 1;
  const elevationRoundingMm = Number.isFinite(Number(constructionSettings.elevationRoundingMm))
    && Number(constructionSettings.elevationRoundingMm) > 0
    ? Number(constructionSettings.elevationRoundingMm)
    : 1;
  const elevationWidth = Number.isFinite(Number(constructionSettings.elevationWidth))
    && Number(constructionSettings.elevationWidth) > 0
    ? Math.round(Number(constructionSettings.elevationWidth))
    : 6;
  const unknownElevationCode = String(constructionSettings.unknownElevationCode || 'XXXXXX').trim()
    || 'XXXXXX';

  const storeys = entityList
    .filter((entity) => entity.type === 'IFCBUILDINGSTOREY')
    .map((entity) => {
      const elevations = getStoreyElevationCandidates(entity, entities);
      return {
        id: entity.id,
        name: getStringArg(entity, 2) || `Bouwlaag ${entity.id}`,
        placementElevationMm: Number.isFinite(elevations.placement)
          ? elevations.placement * scaleToMillimetres
          : null,
        attributeElevationMm: Number.isFinite(elevations.attribute)
          ? elevations.attribute * scaleToMillimetres
          : null,
        elevation: null,
        roundedElevationMm: null,
        elevationCode: unknownElevationCode,
        rank: null,
      };
    });

  const elevationSource = chooseStoreyElevationSource(storeys, elevationRoundingMm);
  for (const storey of storeys) {
    const preferred = elevationSource === 'ObjectPlacement'
      ? storey.placementElevationMm
      : storey.attributeElevationMm;
    const fallback = elevationSource === 'ObjectPlacement'
      ? storey.attributeElevationMm
      : storey.placementElevationMm;
    storey.elevation = Number.isFinite(preferred) ? preferred : fallback;
    storey.roundedElevationMm = Number.isFinite(storey.elevation)
      ? roundConstructionElevation(storey.elevation, elevationRoundingMm)
      : null;
    storey.elevationCode = formatConstructionElevationCode(
      storey.roundedElevationMm,
      elevationWidth,
      unknownElevationCode,
    );
  }

  const withElevation = storeys
    .filter((storey) => Number.isFinite(storey.roundedElevationMm))
    .sort((a, b) => (
      a.roundedElevationMm - b.roundedElevationMm
      || a.elevation - b.elevation
      || a.id - b.id
    ));
  const withoutElevation = storeys
    .filter((storey) => !Number.isFinite(storey.roundedElevationMm))
    .sort((a, b) => normalizeSearchText(a.name).localeCompare(normalizeSearchText(b.name), 'nl') || a.id - b.id);

  let rank = 0;
  let previousElevation = null;
  for (const storey of withElevation) {
    if (previousElevation == null || storey.roundedElevationMm !== previousElevation) {
      rank += 1;
      previousElevation = storey.roundedElevationMm;
    }
    storey.rank = rank;
  }

  let previousName = null;
  for (const storey of withoutElevation) {
    const normalizedName = normalizeSearchText(storey.name);
    if (!normalizedName || normalizedName !== previousName) {
      rank += 1;
      previousName = normalizedName;
    }
    storey.rank = rank;
  }

  const ordered = [...withElevation, ...withoutElevation];
  return {
    byId: new Map(ordered.map((storey) => [storey.id, storey])),
    ordered,
    maxRank: rank,
    elevationSource,
    elevationRoundingMm,
    lengthUnitScaleToMillimetres: scaleToMillimetres,
  };
}

function getStoreyElevationCandidates(storey, entities) {
  if (!storey) return { placement: null, attribute: null };
  const placementId = getSingleRef(storey.args[5]);
  const placementElevation = placementId
    ? resolvePlacementZ(placementId, entities, new Set())
    : null;
  const attributeElevation = numericNodeValue(storey.args[9]);
  return {
    placement: Number.isFinite(placementElevation) ? placementElevation : null,
    attribute: Number.isFinite(attributeElevation) ? attributeElevation : null,
  };
}

function chooseStoreyElevationSource(storeys, roundingMm) {
  const placement = getElevationSourceStats(storeys, 'placementElevationMm', roundingMm);
  const attribute = getElevationSourceStats(storeys, 'attributeElevationMm', roundingMm);

  if (!placement.count && !attribute.count) return 'ObjectPlacement';
  if (!placement.count) return 'Elevation';
  if (!attribute.count) return 'ObjectPlacement';
  if (placement.distinct !== attribute.distinct) {
    return placement.distinct > attribute.distinct ? 'ObjectPlacement' : 'Elevation';
  }
  if (placement.range !== attribute.range) {
    return placement.range > attribute.range ? 'ObjectPlacement' : 'Elevation';
  }
  return placement.count >= attribute.count ? 'ObjectPlacement' : 'Elevation';
}

function getElevationSourceStats(storeys, key, roundingMm) {
  const values = storeys
    .map((storey) => storey[key])
    .filter((value) => Number.isFinite(value));
  const rounded = values.map((value) => roundConstructionElevation(value, roundingMm));
  const unique = new Set(rounded.map((value) => String(value)));
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  return {
    count: values.length,
    distinct: unique.size,
    range: maximum - minimum,
  };
}

function roundConstructionElevation(valueMm, roundingMm) {
  if (!Number.isFinite(valueMm)) return null;
  const increment = Number.isFinite(roundingMm) && roundingMm > 0 ? roundingMm : 1;
  const rounded = Math.round(valueMm / increment) * increment;
  return Math.abs(rounded) < 1e-9 ? 0 : Number(rounded.toFixed(6));
}

function formatConstructionElevationCode(valueMm, width, unknownCode) {
  if (!Number.isFinite(valueMm)) return unknownCode;
  const rounded = Math.round(valueMm);
  const sign = rounded < 0 ? '-' : '';
  const magnitude = String(Math.abs(rounded)).padStart(Math.max(1, width), '0');
  return `${sign}${magnitude}`;
}

function detectLengthUnitScaleToMillimetres(entityList, entities) {
  const projectUnitIds = [];
  for (const project of entityList) {
    if (project.type !== 'IFCPROJECT') continue;
    const assignmentId = getSingleRef(project.args[8]);
    const assignment = assignmentId ? entities.get(assignmentId) : null;
    if (assignment?.type === 'IFCUNITASSIGNMENT') {
      projectUnitIds.push(...getRefIds(assignment.args[0]));
    }
  }

  for (const unitId of projectUnitIds) {
    const scale = resolveLengthUnitScaleToMillimetres(unitId, entities, new Set());
    if (Number.isFinite(scale) && scale > 0) return scale;
  }

  for (const entity of entityList) {
    if (!['IFCSIUNIT', 'IFCCONVERSIONBASEDUNIT', 'IFCCONVERSIONBASEDUNITWITHOFFSET', 'IFCCONTEXTDEPENDENTUNIT'].includes(entity.type)) {
      continue;
    }
    const scale = resolveLengthUnitScaleToMillimetres(entity.id, entities, new Set());
    if (Number.isFinite(scale) && scale > 0) return scale;
  }

  // Millimetres are the most common IFC export unit and preserve the previous behaviour.
  return 1;
}

function resolveLengthUnitScaleToMillimetres(unitId, entities, visited) {
  if (!unitId || visited.has(unitId)) return null;
  visited.add(unitId);
  const unit = entities.get(unitId);
  if (!unit) return null;

  if (unit.type === 'IFCSIUNIT') {
    const unitType = String(stringValue(unit.args[1]) || '').toUpperCase();
    const unitName = String(stringValue(unit.args[3]) || '').toUpperCase();
    if (unitType !== 'LENGTHUNIT' || unitName !== 'METRE') return null;
    const prefix = String(stringValue(unit.args[2]) || '').toUpperCase();
    const prefixFactor = getSiPrefixFactor(prefix);
    return Number.isFinite(prefixFactor) ? 1000 * prefixFactor : null;
  }

  if (unit.type === 'IFCCONVERSIONBASEDUNIT' || unit.type === 'IFCCONVERSIONBASEDUNITWITHOFFSET') {
    const unitType = String(stringValue(unit.args[1]) || '').toUpperCase();
    if (unitType !== 'LENGTHUNIT') return null;
    const conversionId = getSingleRef(unit.args[3]);
    const conversion = conversionId ? entities.get(conversionId) : null;
    if (conversion?.type !== 'IFCMEASUREWITHUNIT') {
      return getLengthUnitNameScaleToMillimetres(stringValue(unit.args[2]));
    }
    const factor = numericNodeValue(conversion.args[0]);
    const baseUnitId = getSingleRef(conversion.args[1]);
    const baseScale = baseUnitId
      ? resolveLengthUnitScaleToMillimetres(baseUnitId, entities, visited)
      : null;
    if (Number.isFinite(factor) && Number.isFinite(baseScale)) return factor * baseScale;
    return getLengthUnitNameScaleToMillimetres(stringValue(unit.args[2]));
  }

  if (unit.type === 'IFCCONTEXTDEPENDENTUNIT') {
    const unitType = String(stringValue(unit.args[1]) || '').toUpperCase();
    if (unitType !== 'LENGTHUNIT') return null;
    return getLengthUnitNameScaleToMillimetres(stringValue(unit.args[2]));
  }

  return null;
}

function getSiPrefixFactor(prefix) {
  const factors = {
    EXA: 1e18,
    PETA: 1e15,
    TERA: 1e12,
    GIGA: 1e9,
    MEGA: 1e6,
    KILO: 1e3,
    HECTO: 1e2,
    DECA: 1e1,
    DECI: 1e-1,
    CENTI: 1e-2,
    MILLI: 1e-3,
    MICRO: 1e-6,
    NANO: 1e-9,
    PICO: 1e-12,
    FEMTO: 1e-15,
    ATTO: 1e-18,
  };
  if (!prefix) return 1;
  return Object.prototype.hasOwnProperty.call(factors, prefix) ? factors[prefix] : null;
}

function getLengthUnitNameScaleToMillimetres(value) {
  const normalized = normalizeSearchText(value).replace(/\s+/g, '');
  if (!normalized) return null;
  if (['mm', 'millimeter', 'millimetre', 'millimeters', 'millimetres'].includes(normalized)) return 1;
  if (['cm', 'centimeter', 'centimetre', 'centimeters', 'centimetres'].includes(normalized)) return 10;
  if (['m', 'meter', 'metre', 'meters', 'metres'].includes(normalized)) return 1000;
  if (['inch', 'inches', 'in'].includes(normalized)) return 25.4;
  if (['foot', 'feet', 'ft'].includes(normalized)) return 304.8;
  return null;
}

function findStoreyByObjectPlacement(entity, storeySequence, entities) {
  if (!entity || !storeySequence || !storeySequence.ordered.length) return null;
  const placementId = getSingleRef(entity.args[5]);
  const rawObjectZ = placementId ? resolvePlacementZ(placementId, entities, new Set()) : null;
  const objectZ = Number.isFinite(rawObjectZ)
    ? rawObjectZ * (storeySequence.lengthUnitScaleToMillimetres || 1)
    : null;
  if (!Number.isFinite(objectZ)) return null;

  const elevatedStoreys = storeySequence.ordered.filter((storey) => Number.isFinite(storey.elevation));
  if (!elevatedStoreys.length) return null;

  let nearest = elevatedStoreys[0];
  let nearestDistance = Math.abs(objectZ - nearest.elevation);
  let below = null;

  for (const storey of elevatedStoreys) {
    const distance = Math.abs(objectZ - storey.elevation);
    if (distance < nearestDistance) {
      nearest = storey;
      nearestDistance = distance;
    }
    if (storey.elevation <= objectZ + 1e-7) below = storey;
  }

  return (below || nearest).id;
}

function resolvePlacementZ(placementId, entities, visited) {
  if (!placementId || visited.has(placementId)) return null;
  visited.add(placementId);
  const placement = entities.get(placementId);
  if (!placement) return null;

  if (placement.type === 'IFCLOCALPLACEMENT') {
    const parentId = getSingleRef(placement.args[0]);
    const relativeId = getSingleRef(placement.args[1]);
    const parentZ = parentId ? resolvePlacementZ(parentId, entities, visited) : 0;
    const relativeZ = relativeId ? resolveAxisPlacementZ(relativeId, entities, visited) : 0;
    const safeParent = Number.isFinite(parentZ) ? parentZ : 0;
    const safeRelative = Number.isFinite(relativeZ) ? relativeZ : 0;
    return safeParent + safeRelative;
  }

  if (placement.type === 'IFCAXIS2PLACEMENT3D' || placement.type === 'IFCAXIS2PLACEMENT2D') {
    return resolveAxisPlacementZ(placement.id, entities, visited);
  }

  if (placement.type === 'IFCCARTESIANPOINT') {
    return getCartesianPointZ(placement);
  }

  return null;
}

function resolveAxisPlacementZ(axisPlacementId, entities, visited) {
  if (!axisPlacementId || visited.has(`axis:${axisPlacementId}`)) return null;
  visited.add(`axis:${axisPlacementId}`);
  const axisPlacement = entities.get(axisPlacementId);
  if (!axisPlacement) return null;
  if (axisPlacement.type === 'IFCCARTESIANPOINT') return getCartesianPointZ(axisPlacement);
  const locationId = getSingleRef(axisPlacement.args[0]);
  const location = locationId ? entities.get(locationId) : null;
  return location?.type === 'IFCCARTESIANPOINT' ? getCartesianPointZ(location) : null;
}

function getCartesianPointZ(point) {
  if (!point || point.type !== 'IFCCARTESIANPOINT') return null;
  const coordinates = getListItems(point.args[0]);
  if (!coordinates.length) return null;
  if (coordinates.length < 3) return 0;
  return numericNodeValue(coordinates[2]);
}

function numericNodeValue(node) {
  if (!node) return null;
  if (node.kind === 'typed') return numericNodeValue(node.value);
  if (node.kind === 'number') {
    const value = Number(node.value);
    return Number.isFinite(value) ? value : null;
  }
  if (node.kind === 'raw' || node.kind === 'string') {
    const value = Number(String(node.value || '').replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function collectCommonProperties(objectId, typeId, index, entities, psetRegex, config) {
  const result = new Map();
  const sourceIds = [];
  if (typeId) sourceIds.push(typeId);
  sourceIds.push(objectId);

  for (const sourceId of sourceIds) {
    const psetIds = index.directPsetsByObject.get(sourceId) || [];
    for (const psetId of psetIds) {
      const psetName = index.psetNameById.get(psetId) || '';
      psetRegex.lastIndex = 0;
      if (!psetRegex.test(psetName)) continue;

      const propertyIds = index.psetProperties.get(psetId) || [];
      for (const propertyId of propertyIds) {
        const property = entities.get(propertyId);
        if (!property) continue;
        const propertyName = getStringArg(property, 0);
        if (!propertyName) continue;
        const propertyValue = extractPropertyValue(property, entities);
        if (propertyValue == null) continue;
        result.set(normalizeKey(propertyName), propertyValue);
      }
    }
  }

  return result;
}

function extractPropertyValue(property, entities) {
  switch (property.type) {
    case 'IFCPROPERTYSINGLEVALUE':
      return unwrapStepValue(property.args[2], entities);

    case 'IFCPROPERTYENUMERATEDVALUE': {
      const values = getListItems(property.args[2]).map((value) => unwrapStepValue(value, entities)).filter((value) => value != null);
      return values.length ? values.join('; ') : null;
    }

    case 'IFCPROPERTYLISTVALUE': {
      const values = getListItems(property.args[2]).map((value) => unwrapStepValue(value, entities)).filter((value) => value != null);
      return values.length ? values.join('; ') : null;
    }

    case 'IFCPROPERTYBOUNDEDVALUE': {
      const upper = unwrapStepValue(property.args[2], entities);
      const lower = unwrapStepValue(property.args[3], entities);
      const setPoint = unwrapStepValue(property.args[5], entities);
      if (setPoint != null) return setPoint;
      if (lower != null && upper != null) return `${lower} tot ${upper}`;
      return lower != null ? lower : upper;
    }

    case 'IFCPROPERTYREFERENCEVALUE':
      return unwrapStepValue(property.args[3], entities);

    default:
      return null;
  }
}

function unwrapStepValue(node, entities) {
  if (!node || node.kind === 'null' || node.kind === 'derived' || node.kind === 'logical') return null;
  if (node.kind === 'typed') return unwrapStepValue(node.value, entities);
  if (node.kind === 'string' || node.kind === 'enum' || node.kind === 'number' || node.kind === 'boolean') return node.value;
  if (node.kind === 'raw') return node.value || null;
  if (node.kind === 'list') {
    const values = node.value.map((value) => unwrapStepValue(value, entities)).filter((value) => value != null);
    return values.join('; ');
  }
  if (node.kind === 'ref') {
    const referenced = entities.get(node.value);
    if (!referenced) return `#${node.value}`;
    return getStringArg(referenced, 2) || getStringArg(referenced, 0) || `#${node.value}`;
  }
  return null;
}

function findMatchingClassification(objectId, typeId, index, entities, aliases, inheritTypeClassification) {
  const matches = [];
  collectClassificationMatches(objectId, false, matches, index, entities, aliases);
  if (inheritTypeClassification && typeId) {
    collectClassificationMatches(typeId, true, matches, index, entities, aliases);
  }

  matches.sort((a, b) => {
    if (a.inheritedFromType !== b.inheritedFromType) return a.inheritedFromType ? 1 : -1;
    const specificityDifference = classificationCodeSpecificity(b.code) - classificationCodeSpecificity(a.code);
    if (specificityDifference !== 0) return specificityDifference;
    if (a.aliasIndex !== b.aliasIndex) return a.aliasIndex - b.aliasIndex;
    return a.referenceId - b.referenceId;
  });

  return { match: matches[0] || null, matches };
}

function classificationCodeSpecificity(code) {
  const match = String(code || '').match(/\d{2}[.,]\d{1,3}|\d{2,5}/);
  return match ? match[0].replace(/\D/g, '').length : 0;
}

function collectClassificationMatches(objectId, inheritedFromType, matches, index, entities, aliases) {
  const classificationIds = index.directClassificationsByObject.get(objectId) || [];
  for (const classificationId of classificationIds) {
    const reference = index.classificationRefs.get(classificationId);
    if (!reference || !reference.code) continue;
    const source = resolveClassificationSource(reference.sourceId, index, new Set());
    const systemName = source.name || '';
    const aliasIndex = findAliasIndex(systemName, aliases);
    if (aliasIndex < 0) continue;

    matches.push({
      referenceId: reference.id,
      systemId: source.id,
      systemName,
      code: reference.code,
      referenceName: reference.name,
      aliasIndex,
      inheritedFromType,
    });
  }
}

function resolveClassificationSource(sourceId, index, visited) {
  if (!sourceId || visited.has(sourceId)) return { id: null, name: '' };
  visited.add(sourceId);

  if (index.classificationNames.has(sourceId)) {
    return { id: sourceId, name: index.classificationNames.get(sourceId) || '' };
  }

  const reference = index.classificationRefs.get(sourceId);
  if (reference) return resolveClassificationSource(reference.sourceId, index, visited);
  return { id: null, name: '' };
}

function normalizeAliases(input) {
  const values = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const aliases = [];
  const seen = new Set();
  for (const value of values) {
    const alias = String(value || '').trim();
    const normalized = normalizeSearchText(alias);
    if (!alias || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(alias);
  }
  return aliases;
}

function findAliasIndex(systemName, aliases) {
  const normalizedSystem = normalizeSearchText(systemName);
  if (!normalizedSystem) return -1;

  if (isTwoDigitClassificationName(systemName)) return -1;
  if (normalizedSystem.includes('nlsfb')) return 0;

  for (let index = 0; index < aliases.length; index += 1) {
    const normalizedAlias = normalizeSearchText(aliases[index]);
    if (!normalizedAlias) continue;
    if (normalizedSystem === normalizedAlias || normalizedSystem.includes(normalizedAlias)) return index + 1;
  }
  return -1;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function buildNlsfbLookup(entries) {
  const byCode = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || !entry[0]) continue;
    const code = String(entry[0]).trim();
    byCode.set(code, {
      code,
      name: stripOfficialCodePrefix(entry[1] || '', code),
      uri: entry[2] ? String(entry[2]) : null,
      parent: entry[3] ? String(entry[3]) : null,
    });
  }
  return { byCode };
}

function stripOfficialCodePrefix(name, code) {
  const value = String(name || '').trim();
  const stripped = value.replace(/^\([^)]*\)\s*/, '').trim();
  return stripped || value || code;
}

function canonicalizeClassificationCode(code, lookup) {
  const original = String(code || '').trim();
  if (!original) return null;

  const candidates = [];
  const addCandidate = (value) => {
    const normalized = String(value || '').trim().replace(',', '.');
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  addCandidate(original);

  const withoutParens = original.replace(/^\(([^)]+)\).*$/, '$1').trim();
  addCandidate(withoutParens);

  const separatedMatch = original.match(/(\d{2})\D+(\d{1,3})/);
  if (separatedMatch) addCandidate(`${separatedMatch[1]}.${separatedMatch[2]}`);

  const tokenMatch = original.match(/\d{2}[.,]\d{1,3}|\d{3,5}|\d{2}/);
  if (tokenMatch) {
    const token = tokenMatch[0].replace(',', '.');
    addCandidate(token);
    if (/^\d{3,5}$/.test(token)) {
      addCandidate(`${token.slice(0, 2)}.${token.slice(2)}`);
    }
  }

  for (const candidate of candidates) {
    if (lookup.has(candidate)) return candidate;
  }
  return null;
}

function rewriteClassificationMetadata(
  dataText,
  entities,
  index,
  primaryClassificationIds,
  twoDigitClassificationIds,
  desiredTwoDigitCodeByElement,
  constructionSequenceClassificationIds,
  desiredConstructionSequenceCodeByElement,
  constructionSequenceDescriptionsByCode,
  nlsfb,
  canonicalName,
  twoDigitName,
  constructionSequenceName,
) {
  const replacements = [];
  let systemNamesChangedCount = 0;
  let referenceNamesChangedCount = 0;
  let twoDigitRelationsCleanedCount = 0;
  let constructionSequenceRelationsCleanedCount = 0;

  for (const entity of entities.values()) {
    if (!Number.isInteger(entity.start) || !Number.isInteger(entity.end)) continue;

    if (entity.type === 'IFCCLASSIFICATION') {
      let desiredName = null;
      if (primaryClassificationIds.has(entity.id)) desiredName = canonicalName;
      else if (twoDigitClassificationIds.has(entity.id)) desiredName = twoDigitName;
      else if (constructionSequenceClassificationIds.has(entity.id)) desiredName = constructionSequenceName;
      if (!desiredName || getStringArg(entity, 3) === desiredName) continue;

      replacements.push(createEntityArgumentReplacement(entity, 3, desiredName));
      systemNamesChangedCount += 1;
      continue;
    }

    if (entity.type === 'IFCRELASSOCIATESCLASSIFICATION') {
      const referenceId = getSingleRef(entity.args[5]);
      const reference = referenceId ? index.classificationRefs.get(referenceId) : null;
      if (!reference) continue;

      const source = resolveClassificationSource(reference.sourceId, index, new Set());
      if (!source.id) continue;

      let desiredCodes = null;
      let referenceCode = String(reference.code || '').trim();
      let relationType = null;

      if (twoDigitClassificationIds.has(source.id)) {
        referenceCode = referenceCode.toUpperCase() === MISSING_NLSFB_CODE
          ? MISSING_NLSFB_CODE
          : deriveTwoDigitCode(referenceCode) || referenceCode;
        desiredCodes = desiredTwoDigitCodeByElement;
        relationType = 'twoDigit';
      } else if (constructionSequenceClassificationIds.has(source.id)) {
        desiredCodes = desiredConstructionSequenceCodeByElement;
        relationType = 'constructionSequence';
      } else {
        continue;
      }

      const relatedObjectIds = getRefIds(entity.args[4]);
      const retainedObjectIds = relatedObjectIds.filter((objectId) => {
        const desiredCode = desiredCodes.get(objectId);
        return !desiredCode || desiredCode === referenceCode;
      });

      if (retainedObjectIds.length === relatedObjectIds.length) continue;

      if (retainedObjectIds.length) {
        replacements.push(createEntityRawArgumentReplacement(
          entity,
          4,
          `(${retainedObjectIds.map((id) => `#${id}`).join(',')})`,
        ));
      } else {
        replacements.push({ start: entity.start, end: entity.end, value: '' });
      }

      const removedCount = relatedObjectIds.length - retainedObjectIds.length;
      if (relationType === 'twoDigit') twoDigitRelationsCleanedCount += removedCount;
      else constructionSequenceRelationsCleanedCount += removedCount;
      continue;
    }

    if (entity.type !== 'IFCCLASSIFICATIONREFERENCE') continue;
    const reference = index.classificationRefs.get(entity.id);
    if (!reference) continue;
    const source = resolveClassificationSource(reference.sourceId, index, new Set());
    const sourceId = source.id;
    if (!sourceId) continue;

    let desiredName = null;
    if (primaryClassificationIds.has(sourceId)) {
      desiredName = resolvePrimaryClassificationDescription(reference.code, nlsfb.byCode);
    } else if (twoDigitClassificationIds.has(sourceId)) {
      const twoDigitCode = deriveTwoDigitCode(reference.code) || String(reference.code || '').trim();
      const official = twoDigitCode ? nlsfb.byCode.get(twoDigitCode) : null;
      const description = twoDigitCode === MISSING_NLSFB_CODE
        ? TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION
        : official ? official.name : TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION;
      desiredName = formatTwoDigitReferenceName(twoDigitCode, description);
    } else if (constructionSequenceClassificationIds.has(sourceId)) {
      const code = String(reference.code || '').trim();
      desiredName = constructionSequenceDescriptionsByCode.get(code) || null;
    }

    if (!desiredName || getStringArg(entity, 2) === desiredName) continue;
    replacements.push(createEntityArgumentReplacement(entity, 2, desiredName));
    referenceNamesChangedCount += 1;
  }

  replacements.sort((a, b) => b.start - a.start);
  let output = dataText;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
  }

  return {
    text: output,
    changedCount: replacements.length,
    systemNamesChangedCount,
    referenceNamesChangedCount,
    twoDigitRelationsCleanedCount,
    constructionSequenceRelationsCleanedCount,
  };
}

function createEntityArgumentReplacement(entity, argumentIndex, value) {
  const rawArgs = entity.rawArgs.slice();
  while (rawArgs.length <= argumentIndex) rawArgs.push('$');
  rawArgs[argumentIndex] = encodeStepString(value);
  return {
    start: entity.start,
    end: entity.end,
    value: `#${entity.id}=${entity.type}(${rawArgs.join(',')});`,
  };
}

function createEntityRawArgumentReplacement(entity, argumentIndex, rawValue) {
  const rawArgs = entity.rawArgs.slice();
  while (rawArgs.length <= argumentIndex) rawArgs.push('$');
  rawArgs[argumentIndex] = rawValue;
  return {
    start: entity.start,
    end: entity.end,
    value: `#${entity.id}=${entity.type}(${rawArgs.join(',')});`,
  };
}

function resolvePrimaryClassificationDescription(code, lookup) {
  const rawCode = String(code || '').trim();
  if (rawCode.toUpperCase() === MISSING_NLSFB_CODE) return MISSING_NLSFB_DESCRIPTION;
  const canonicalCode = canonicalizeClassificationCode(rawCode, lookup);
  const official = canonicalCode ? lookup.get(canonicalCode) : null;
  return official ? official.name : UNKNOWN_NLSFB_DESCRIPTION;
}

function formatTwoDigitReferenceName(code, description) {
  const cleanDescription = String(description || TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION).trim();
  return cleanDescription || TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION;
}

function isTwoDigitClassificationName(name) {
  const normalized = normalizeSearchText(name);
  if (!normalized) return false;
  const acceptedNames = [TWO_DIGIT_CLASSIFICATION_NAME, ...LEGACY_TWO_DIGIT_CLASSIFICATION_NAMES];
  return acceptedNames.some((candidate) => normalized === normalizeSearchText(candidate));
}

function deriveTwoDigitCode(code) {
  const leading = String(code || '').trim().match(/^\(?\s*(\d{2})/);
  return leading ? leading[1] : null;
}


function normalizeConstructionSequenceConfig(data) {
  if (!data || !Array.isArray(data.fases) || !data.fases.length) {
    throw new Error('bouwvolgorde_nlsfb.json bevat geen bruikbare fases.');
  }

  const rawSettings = data.instellingen && typeof data.instellingen === 'object'
    ? data.instellingen
    : {};
  const settings = {
    codePropertyName: String(rawSettings.eigenschap_code || DEFAULT_CONSTRUCTION_SEQUENCE_CODE_PROPERTY).trim()
      || DEFAULT_CONSTRUCTION_SEQUENCE_CODE_PROPERTY,
    descriptionPropertyName: String(rawSettings.eigenschap_omschrijving || DEFAULT_CONSTRUCTION_SEQUENCE_DESCRIPTION_PROPERTY).trim()
      || DEFAULT_CONSTRUCTION_SEQUENCE_DESCRIPTION_PROPERTY,
    codeFormat: String(rawSettings.code_formaat || '{fase}.{bouwlaag}.{stap}').trim()
      || '{fase}.{bouwlaag}.{stap}',
    descriptionFormat: String(rawSettings.omschrijving_formaat || '{omschrijving}').trim()
      || '{omschrijving}',
    elevationRoundingMm: toPositiveNumber(rawSettings.bouwlaag_afronding_mm, 1),
    elevationWidth: toPositiveInteger(
      rawSettings.bouwlaag_z_breedte ?? rawSettings.bouwlaag_breedte,
      6,
    ),
    unknownElevationCode: String(rawSettings.bouwlaag_onbekend_code || 'XXXXXX').trim()
      || 'XXXXXX',
    phaseWidth: toPositiveInteger(rawSettings.fase_breedte, 2),
    stepWidth: toPositiveInteger(rawSettings.stap_breedte, 2),
    missingCode: String(rawSettings.onbekend_code || DEFAULT_CONSTRUCTION_SEQUENCE_MISSING_CODE).trim()
      || DEFAULT_CONSTRUCTION_SEQUENCE_MISSING_CODE,
    missingDescription: String(rawSettings.onbekend_omschrijving || DEFAULT_CONSTRUCTION_SEQUENCE_MISSING_DESCRIPTION).trim()
      || DEFAULT_CONSTRUCTION_SEQUENCE_MISSING_DESCRIPTION,
    unmappedCode: String(rawSettings.geen_regel_code || DEFAULT_CONSTRUCTION_SEQUENCE_UNMAPPED_CODE).trim()
      || DEFAULT_CONSTRUCTION_SEQUENCE_UNMAPPED_CODE,
    unmappedDescription: String(rawSettings.geen_regel_omschrijving || DEFAULT_CONSTRUCTION_SEQUENCE_UNMAPPED_DESCRIPTION).trim()
      || DEFAULT_CONSTRUCTION_SEQUENCE_UNMAPPED_DESCRIPTION,
  };

  const rules = [];
  let order = 0;
  for (let phaseIndex = 0; phaseIndex < data.fases.length; phaseIndex += 1) {
    const phase = data.fases[phaseIndex] || {};
    const phaseId = toPositiveInteger(phase.fase_id, phaseIndex + 1);
    const phaseName = String(phase.fase_naam || `Fase ${phaseId}`).trim();
    const steps = Array.isArray(phase.stappen) ? phase.stappen : [];

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex] || {};
      const codes = Array.isArray(step.nlsfb_codes)
        ? step.nlsfb_codes.map(normalizeConstructionRuleCode).filter(Boolean)
        : [];
      if (!codes.length) continue;

      const stepId = String(step.stap_id || `${phaseId}.${stepIndex + 1}`).trim();
      const stepNumber = toPositiveInteger(
        step.volgorde_nummer,
        deriveConstructionStepNumber(stepId, stepIndex + 1),
      );
      const loadBearing = typeof step.dragend === 'boolean' ? step.dragend : null;

      rules.push({
        phaseId,
        phaseName,
        stepId,
        stepNumber,
        description: String(step.omschrijving || stepId).trim() || stepId,
        codes,
        floorSelection: normalizeFloorSelection(step.bouwlaag_selectie),
        loadBearing,
        order,
      });
      order += 1;
    }
  }

  if (!rules.length) {
    throw new Error('bouwvolgorde_nlsfb.json bevat geen stappen met NL-SfB codes.');
  }

  return {
    metadata: {
      version: String(data.project_metadata?.version || '1.0').trim() || '1.0',
    },
    settings,
    rules,
  };
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) return Math.round(number);
  return fallback;
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  return fallback;
}

function deriveConstructionStepNumber(stepId, fallbackIndex) {
  const match = String(stepId || '').match(/(?:^|\.)(\d+)$/);
  if (!match) return fallbackIndex * 10;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value * 10 : fallbackIndex * 10;
}

function normalizeConstructionRuleCode(value) {
  const raw = String(value || '').trim().replace(',', '.');
  if (!raw) return '';
  const parenthesized = raw.match(/^\(([^)]+)\)/);
  const source = parenthesized ? parenthesized[1] : raw;
  const match = source.match(/\d{2}(?:\.\d{1,3})?|\d{3,5}/);
  if (!match) return source.toUpperCase();
  const token = match[0];
  if (/^\d{3,5}$/.test(token)) return `${token.slice(0, 2)}.${token.slice(2)}`;
  return token;
}

function normalizeFloorSelection(value) {
  const normalized = normalizeSearchText(value || 'per_bouwlaag');
  if (normalized === 'laagste') return 'lowest';
  if (normalized === 'hoogste') return 'highest';
  if (normalized === 'vanaf_tweede' || normalized === 'vanaf2' || normalized === 'vanafdetweede') return 'fromSecond';
  return 'perFloor';
}

function resolveConstructionSequenceAssignment({
  sourceCode,
  canonicalSourceCode,
  sourceCodeIsValid,
  storeyInfo,
  storeySequence,
  commonProperties,
  constructionSequence,
}) {
  const settings = constructionSequence.settings;
  if (!sourceCodeIsValid || !canonicalSourceCode) {
    return {
      kind: 'missing',
      code: settings.missingCode,
      description: settings.missingDescription,
    };
  }

  const loadBearingValue = parseBooleanLike(getMapValue(commonProperties, normalizeKey('LoadBearing')));
  const inferredLoadBearing = inferLoadBearingFromNlsfbCode(canonicalSourceCode);
  const effectiveLoadBearing = loadBearingValue == null ? inferredLoadBearing : loadBearingValue;
  const rule = findConstructionSequenceRule(
    canonicalSourceCode,
    effectiveLoadBearing,
    storeyInfo,
    storeySequence,
    constructionSequence.rules,
  );

  if (!rule) {
    return {
      kind: 'unmapped',
      code: settings.unmappedCode,
      description: applyConstructionTemplate(settings.unmappedDescription, {
        nlsfb_code: canonicalSourceCode || sourceCode || '',
      }),
    };
  }

  const elevationCode = storeyInfo?.elevationCode || settings.unknownElevationCode;
  const roundedElevationMm = Number.isFinite(storeyInfo?.roundedElevationMm)
    ? storeyInfo.roundedElevationMm
    : null;
  const tokens = {
    fase: padConstructionNumber(rule.phaseId, settings.phaseWidth),
    bouwlaag: elevationCode,
    bouwlaag_z: elevationCode,
    bouwlaag_z_mm: roundedElevationMm == null ? '' : String(roundedElevationMm),
    stap: padConstructionNumber(rule.stepNumber, settings.stepWidth),
    stap_id: rule.stepId,
    fase_naam: rule.phaseName,
    bouwlaag_naam: storeyInfo?.name || '',
    omschrijving: rule.description,
    nlsfb_code: canonicalSourceCode,
  };

  const code = applyConstructionTemplate(settings.codeFormat, tokens).trim()
    || `${tokens.fase}.${tokens.bouwlaag}.${tokens.stap}`;
  const description = cleanConstructionDescription(
    applyConstructionTemplate(settings.descriptionFormat, tokens),
    rule.description,
  );

  return {
    kind: 'mapped',
    code,
    description,
    rule,
  };
}

function findConstructionSequenceRule(canonicalCode, loadBearing, storeyInfo, storeySequence, rules) {
  const twoDigitCode = deriveTwoDigitCode(canonicalCode);
  let best = null;

  for (const rule of rules) {
    if (!constructionFloorMatches(rule.floorSelection, storeyInfo, storeySequence)) continue;

    let codeScore = 0;
    for (const ruleCode of rule.codes) {
      codeScore = Math.max(codeScore, constructionCodeMatchScore(canonicalCode, twoDigitCode, ruleCode));
    }
    if (!codeScore) continue;

    let conditionScore = 0;
    if (rule.loadBearing != null && (twoDigitCode === '21' || twoDigitCode === '22')) {
      if (loadBearing != null && loadBearing !== rule.loadBearing) continue;
      conditionScore = loadBearing == null ? -25 : 100;
    }

    const floorScore = rule.floorSelection === 'perFloor' ? 0 : 20;
    const score = codeScore + conditionScore + floorScore;
    if (!best || score > best.score || (score === best.score && rule.order < best.rule.order)) {
      best = { rule, score };
    }
  }

  return best ? best.rule : null;
}

function constructionCodeMatchScore(canonicalCode, twoDigitCode, ruleCode) {
  if (!ruleCode) return 0;
  if (canonicalCode === ruleCode) return 1200 + ruleCode.replace(/\D/g, '').length;
  if (ruleCode.includes('.') && canonicalCode.startsWith(ruleCode)) {
    return 900 + ruleCode.replace(/\D/g, '').length;
  }
  if (twoDigitCode && ruleCode === twoDigitCode) return 500;
  return 0;
}

function constructionFloorMatches(selection, storeyInfo, storeySequence) {
  if (selection === 'perFloor') return true;
  const rank = Number(storeyInfo?.rank) || 0;
  const maxRank = Number(storeySequence?.maxRank) || 0;
  if (!rank || !maxRank) return false;
  if (selection === 'lowest') return rank === 1;
  if (selection === 'highest') return rank === maxRank;
  if (selection === 'fromSecond') return rank >= 2;
  return true;
}

function inferLoadBearingFromNlsfbCode(code) {
  const normalized = String(code || '').replace(',', '.');
  if (/^(21|22)\.1/.test(normalized)) return false;
  if (/^(21|22)\.2/.test(normalized)) return true;
  return null;
}

function parseBooleanLike(value) {
  if (value === true || value === false) return value;
  const normalized = normalizeSearchText(value);
  if (['true', 't', 'yes', 'ja', '1'].includes(normalized)) return true;
  if (['false', 'f', 'no', 'nee', '0'].includes(normalized)) return false;
  return null;
}

function padConstructionNumber(value, width) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  return String(safe).padStart(Math.max(1, width), '0');
}

function applyConstructionTemplate(template, values) {
  return String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match
  ));
}

function cleanConstructionDescription(value, fallback) {
  const cleaned = String(value || '')
    .replace(/^\s*[|:;/-]+\s*/, '')
    .replace(/\s*[|:;/-]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || String(fallback || '').trim();
}

function normalizeAttributeConfig(attributes) {
  const defaults = [
    ['storey', 'Bouwlaag', 'label'],
    ['name', 'Naam', 'label'],
    ['typeName', 'Type', 'label'],
    ['ifcEntity', 'IFC entiteit', 'label'],
    ['predefinedType', 'IFC PredefinedType', 'label'],
    ['objectType', 'Objecttype', 'label'],
  ];

  const supplied = new Map();
  for (const attribute of attributes) {
    if (!attribute || !attribute.key) continue;
    supplied.set(attribute.key, attribute);
  }

  return defaults.map(([key, defaultName, type]) => {
    const source = supplied.get(key) || {};
    return {
      key,
      outputName: String(source.outputName || defaultName).trim() || defaultName,
      type,
    };
  });
}

function normalizeCommonPropertyMappings(mappings, legacyConfig) {
  const defaults = [
    { sourceName: legacyConfig.isExternalPropertyName || 'IsExternal', outputName: 'Buiten' },
    { sourceName: legacyConfig.loadBearingPropertyName || 'LoadBearing', outputName: 'Dragend' },
    { sourceName: legacyConfig.fireRatingPropertyName || 'FireRating', outputName: 'WBDBO' },
    { sourceName: 'AcousticRating', outputName: 'Geluidwerendheid' },
    { sourceName: 'ThermalTransmittance', outputName: 'Warmtedoorgangscoëfficiënt' },
  ];

  const source = Array.isArray(mappings) ? mappings : defaults;
  return source
    .map((mapping) => ({
      sourceName: String(mapping && mapping.sourceName || '').trim(),
      outputName: String(mapping && mapping.outputName || '').trim(),
    }))
    .filter((mapping) => mapping.sourceName && mapping.outputName)
    .map((mapping) => ({
      ...mapping,
      type: ['isexternal', 'loadbearing'].includes(normalizeKey(mapping.sourceName)) ? 'boolean' : 'auto',
    }));
}

function buildTargetProperties(candidates, addWarning, expressId) {
  const properties = [];
  const usedNames = new Set();

  for (const candidate of candidates) {
    if (!candidate || !candidate.name) continue;
    const value = candidate.value;
    const isMissing = value == null || (typeof value === 'string' && value.trim() === '');
    if (isMissing) continue;

    const normalizedName = normalizeKey(candidate.name);
    if (usedNames.has(normalizedName)) {
      addWarning('DUPLICATE_TARGET_PROPERTY', `Doeleigenschap ${candidate.name} komt dubbel voor en is eenmaal opgenomen.`, expressId);
      continue;
    }
    usedNames.add(normalizedName);

    properties.push({
      name: candidate.name,
      type: candidate.type || 'auto',
      value,
    });
  }

  return properties;
}

function serializeNominalValue(type, value) {
  if (value == null) return '$';
  if (type === 'auto') {
    if (typeof value === 'boolean') type = 'boolean';
    else if (typeof value === 'number' && Number.isFinite(value)) type = 'number';
    else type = 'label';
  }
  if (type === 'boolean') {
    if (value === true || String(value).toLowerCase() === 'true' || String(value).toUpperCase() === 'T') return 'IFCBOOLEAN(.T.)';
    if (value === false || String(value).toLowerCase() === 'false' || String(value).toUpperCase() === 'F') return 'IFCBOOLEAN(.F.)';
    return `IFCLABEL(${encodeStepString(String(value))})`;
  }

  if (type === 'identifier') return `IFCIDENTIFIER(${encodeStepString(String(value))})`;
  if (typeof value === 'number' && Number.isFinite(value)) return `IFCREAL(${formatNumber(value)})`;
  return `IFCLABEL(${encodeStepString(String(value))})`;
}

function formatNumber(value) {
  if (Number.isInteger(value)) return `${value}.`;
  return String(value);
}

function extractPredefinedType(entity, typeEntity, schemaKey) {
  const direct = extractPredefinedFromEntity(entity, schemaKey, false);
  if (direct) return direct;
  return typeEntity ? extractPredefinedFromEntity(typeEntity, schemaKey, true) : null;
}

function extractPredefinedFromEntity(entity, schemaKey, isType) {
  if (!entity) return null;
  if (schemaKey === 'IFC2X3' && entity.type.endsWith('STYLE')) return null;

  const fixedIndexes = {
    IFC4: {
      IFCDOOR: 10,
      IFCWINDOW: 10,
      IFCDOORTYPE: 9,
      IFCWINDOWTYPE: 9,
    },
    IFC4X3: {
      IFCDOOR: 10,
      IFCWINDOW: 10,
      IFCDOORTYPE: 9,
      IFCWINDOWTYPE: 9,
    },
  };

  const fixedIndex = fixedIndexes[schemaKey]?.[entity.type];
  if (Number.isInteger(fixedIndex)) {
    const fixed = enumValue(entity.args[fixedIndex]);
    if (fixed) return fixed;
  }

  const ignored = new Set(['ELEMENT', 'COMPLEX', 'PARTIAL']);
  for (let index = entity.args.length - 1; index >= 5; index -= 1) {
    const value = enumValue(entity.args[index]);
    if (!value || ignored.has(value)) continue;
    return value;
  }

  return null;
}

function enumValue(node) {
  if (!node) return null;
  if (node.kind === 'enum') return node.value;
  if (node.kind === 'typed') return enumValue(node.value);
  return null;
}

function hasDirectPsetNamed(objectId, name, index, entities) {
  const psetIds = index.directPsetsByObject.get(objectId) || [];
  const normalizedTarget = normalizeKey(name);
  return psetIds.some((psetId) => normalizeKey(index.psetNameById.get(psetId) || getStringArg(entities.get(psetId), 2)) === normalizedTarget);
}

function compileCommonPsetRegex(pattern) {
  try {
    return new RegExp(String(pattern || '^Pset_.*Common$'), 'i');
  } catch (error) {
    throw new Error(`Ongeldig Common Pset patroon: ${error.message}`);
  }
}

function normalizeTargetPsetName(value) {
  const name = String(value || '').trim();
  if (!name) throw new Error('Vul een naam voor de nieuwe Pset in.');
  if (name.length > 255) throw new Error('De Pset naam is langer dan 255 tekens.');
  return name;
}

function findClassificationByNames(names, entityList) {
  const normalizedNames = new Set(names.map((name) => normalizeSearchText(name)));
  for (const entity of entityList) {
    if (entity.type !== 'IFCCLASSIFICATION') continue;
    if (normalizedNames.has(normalizeSearchText(getStringArg(entity, 3)))) return entity.id;
  }
  return null;
}

function hasDirectClassificationReference(objectId, referenceId, index) {
  const references = index.directClassificationsByObject.get(objectId) || [];
  return references.includes(referenceId);
}

function selectPrimaryClassificationSystemId(index, classificationIds, canonicalName) {
  const ids = Array.from(classificationIds);
  if (!ids.length) return null;
  const canonical = normalizeSearchText(canonicalName);

  ids.sort((a, b) => {
    const nameA = index.classificationNames.get(a) || '';
    const nameB = index.classificationNames.get(b) || '';
    const normalizedA = normalizeSearchText(nameA);
    const normalizedB = normalizeSearchText(nameB);
    const rankA = normalizedA === canonical ? 0 : normalizedA.includes('nlsfb') ? 1 : 2;
    const rankB = normalizedB === canonical ? 0 : normalizedB.includes('nlsfb') ? 1 : 2;
    return rankA - rankB || a - b;
  });

  return ids[0];
}

function addClassificationEntity(addEntity, schemaKey, name) {
  if (schemaKey === 'IFC2X3') {
    return addEntity(
      'IFCCLASSIFICATION',
      `${encodeStepString('ketenstandaard')},${encodeStepString('2021')},$,${encodeStepString(name)}`,
    );
  }
  return addEntity(
    'IFCCLASSIFICATION',
    `${encodeStepString('ketenstandaard')},${encodeStepString('2021')},$,${encodeStepString(name)},$,${encodeStepString('https://data.ketenstandaard.nl/publications/nlsfb/2021')},$`,
  );
}

function addConstructionSequenceClassificationEntity(addEntity, schemaKey, version) {
  const source = 'Organize my IFC';
  const edition = String(version || '1.0').trim() || '1.0';
  if (schemaKey === 'IFC2X3') {
    return addEntity(
      'IFCCLASSIFICATION',
      `${encodeStepString(source)},${encodeStepString(edition)},$,${encodeStepString(CONSTRUCTION_SEQUENCE_CLASSIFICATION_NAME)}`,
    );
  }
  return addEntity(
    'IFCCLASSIFICATION',
    `${encodeStepString(source)},${encodeStepString(edition)},$,${encodeStepString(CONSTRUCTION_SEQUENCE_CLASSIFICATION_NAME)},$,$,$`,
  );
}

function addClassificationReferenceEntity(addEntity, schemaKey, classificationId, code, name, uri) {
  const location = uri ? encodeStepString(uri) : '$';
  const identification = encodeStepString(code);
  const referenceName = name ? encodeStepString(name) : '$';
  if (schemaKey === 'IFC2X3') {
    return addEntity(
      'IFCCLASSIFICATIONREFERENCE',
      `${location},${identification},${referenceName},#${classificationId}`,
    );
  }
  return addEntity(
    'IFCCLASSIFICATIONREFERENCE',
    `${location},${identification},${referenceName},#${classificationId},$,$`,
  );
}

function findClassificationReferencesForSource(classificationId, entityList, entities) {
  const result = new Map();
  for (const entity of entityList) {
    if (entity.type !== 'IFCCLASSIFICATIONREFERENCE') continue;
    const source = getSingleRef(entity.args[3]);
    if (source !== classificationId) continue;
    const code = getStringArg(entity, 1);
    if (code) result.set(String(code).trim(), entity.id);
  }
  return result;
}

function validateNewLines(newLines, oldMaxId, newEntityIds, existingEntities, addWarning) {
  const parsed = parseEntities(newLines.join('\n'));
  if (parsed.list.length !== newLines.length) {
    throw new Error('Interne validatie van de nieuwe IFC entiteiten is mislukt.');
  }

  const allIds = new Set(existingEntities.keys());
  for (const id of newEntityIds) allIds.add(id);

  for (const entity of parsed.list) {
    if (entity.id <= oldMaxId) throw new Error('Nieuwe IFC entiteit gebruikt een bestaand Express ID.');
    for (const arg of entity.args) {
      for (const refId of getRefIds(arg)) {
        if (!allIds.has(refId)) {
          addWarning('UNRESOLVED_NEW_REFERENCE', `Nieuwe entiteit #${entity.id} verwijst naar ontbrekend ID #${refId}.`, entity.id);
        }
      }
    }
  }
}

function createIfcGuid() {
  const bytes = new Uint8Array(16);
  if (self.crypto && self.crypto.getRandomValues) {
    self.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);

  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let result = '';
  for (let index = 0; index < 22; index += 1) {
    result = alphabet[Number(number & 63n)] + result;
    number >>= 6n;
  }
  return result;
}

function getStringArg(entity, index) {
  if (!entity || !entity.args || !entity.args[index]) return null;
  return stringValue(entity.args[index]);
}

function stringValue(node) {
  if (!node || node.kind === 'null' || node.kind === 'derived') return null;
  if (node.kind === 'string') return node.value;
  if (node.kind === 'typed') return stringValue(node.value);
  if (node.kind === 'enum') return node.value;
  if (node.kind === 'number') return String(node.value);
  if (node.kind === 'boolean') return node.value ? 'TRUE' : 'FALSE';
  if (node.kind === 'raw') return node.value || null;
  return null;
}

function getRefIds(node) {
  if (!node) return [];
  if (node.kind === 'ref') return [node.value];
  if (node.kind === 'list') return node.value.flatMap(getRefIds);
  if (node.kind === 'typed') return getRefIds(node.value);
  return [];
}

function getSingleRef(node) {
  const refs = getRefIds(node);
  return refs.length ? refs[0] : null;
}

function getListItems(node) {
  if (!node) return [];
  if (node.kind === 'list') return node.value;
  return [node];
}


function getMapValue(map, key) {
  return map.has(key) ? map.get(key) : null;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function formatIfcEntityName(type) {
  if (!type) return '';
  const exact = {
    IFCWALL: 'IfcWall',
    IFCWALLSTANDARDCASE: 'IfcWallStandardCase',
    IFCSLAB: 'IfcSlab',
    IFCBEAM: 'IfcBeam',
    IFCCOLUMN: 'IfcColumn',
    IFCDOOR: 'IfcDoor',
    IFCWINDOW: 'IfcWindow',
    IFCROOF: 'IfcRoof',
    IFCSTAIR: 'IfcStair',
    IFCSTAIRFLIGHT: 'IfcStairFlight',
    IFCPLATE: 'IfcPlate',
    IFCMEMBER: 'IfcMember',
    IFCFOOTING: 'IfcFooting',
    IFCPILE: 'IfcPile',
    IFCCURTAINWALL: 'IfcCurtainWall',
    IFCBUILDINGELEMENTPROXY: 'IfcBuildingElementProxy',
    IFCFURNISHINGELEMENT: 'IfcFurnishingElement',
    IFCBUILDINGELEMENTPART: 'IfcBuildingElementPart',
    IFCRAILING: 'IfcRailing',
    IFCRAMP: 'IfcRamp',
    IFCRAMPFLIGHT: 'IfcRampFlight',
    IFCCOVERING: 'IfcCovering',
    IFCCHIMNEY: 'IfcChimney',
    IFCSHADINGDEVICE: 'IfcShadingDevice',
    IFCGEOGRAPHICELEMENT: 'IfcGeographicElement',
  };
  return exact[type] || type;
}
