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

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== 'process') return;

  try {
    const { file, config, nlsfbEntries } = message;
    if (!file) throw new Error('Geen IFC bestand ontvangen.');

    postProgress(2, 'IFC bestand lezen');
    const text = await file.text();

    postProgress(8, 'IFC structuur analyseren');
    const result = processIfc(text, config || {}, nlsfbEntries || []);

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

function processIfc(text, config, nlsfbEntries) {
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

  const classificationSystemIdsToNormalize = new Set();
  const twoDigitClassificationSystemIds = new Set();
  for (const [classificationId, classificationName] of index.classificationNames.entries()) {
    if (isTwoDigitClassificationName(classificationName)) {
      twoDigitClassificationSystemIds.add(classificationId);
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
    const storeyId = findStoreyForObject(expressId, index, entities);
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
      const canonicalSourceCode = canonicalizeClassificationCode(sourceCode, nlsfb.byCode);
      const officialSource = canonicalSourceCode ? nlsfb.byCode.get(canonicalSourceCode) : null;
      if (rawSourceCode.toUpperCase() === MISSING_NLSFB_CODE) {
        sourceDescription = MISSING_NLSFB_DESCRIPTION;
        twoDigitCode = MISSING_NLSFB_CODE;
        twoDigitDescription = TWO_DIGIT_UNRESOLVED_NLSFB_DESCRIPTION;
      } else if (officialSource) {
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

  const rewritten = rewriteClassificationMetadata(
    dataText,
    entities,
    index,
    classificationSystemIdsToNormalize,
    twoDigitClassificationSystemIds,
    desiredTwoDigitCodeByElement,
    nlsfb,
    canonicalClassificationName,
    twoDigitClassificationName,
  );
  summary.classificationSystemsNormalized = rewritten.systemNamesChangedCount;
  summary.classificationDescriptionsNormalized = rewritten.referenceNamesChangedCount;
  summary.twoDigitClassificationRelationsCleaned = rewritten.twoDigitRelationsCleanedCount;

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
  nlsfb,
  canonicalName,
  twoDigitName,
) {
  const replacements = [];
  let systemNamesChangedCount = 0;
  let referenceNamesChangedCount = 0;
  let twoDigitRelationsCleanedCount = 0;

  for (const entity of entities.values()) {
    if (!Number.isInteger(entity.start) || !Number.isInteger(entity.end)) continue;

    if (entity.type === 'IFCCLASSIFICATION') {
      let desiredName = null;
      if (primaryClassificationIds.has(entity.id)) desiredName = canonicalName;
      else if (twoDigitClassificationIds.has(entity.id)) desiredName = twoDigitName;
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
      if (!source.id || !twoDigitClassificationIds.has(source.id)) continue;

      const rawReferenceCode = String(reference.code || '').trim();
      const referenceCode = rawReferenceCode.toUpperCase() === MISSING_NLSFB_CODE
        ? MISSING_NLSFB_CODE
        : deriveTwoDigitCode(rawReferenceCode) || rawReferenceCode;
      const relatedObjectIds = getRefIds(entity.args[4]);
      const retainedObjectIds = relatedObjectIds.filter((objectId) => {
        const desiredCode = desiredTwoDigitCodeByElement.get(objectId);
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
      twoDigitRelationsCleanedCount += relatedObjectIds.length - retainedObjectIds.length;
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
