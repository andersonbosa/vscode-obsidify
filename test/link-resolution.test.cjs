const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveWikilinkTarget } = require('../out/link-resolution.js');

const sourcePath = 'Collections/Zettelkasten/Computer Science/DDD, Domain Driven Design.md';
const targetPath = 'Collections/Cadernos/Pós Graduação. Full Cycle. MBA Arquitetura De Software/Módulos/6. DDD Domain Driven Design/6. DDD Domain Driven Design.md';

test('resolves an extensionless wikilink to a Markdown title containing a period in another folder', () => {
  const result = resolveWikilinkTarget([sourcePath, targetPath], sourcePath, '6. DDD Domain Driven Design');

  assert.deepEqual(result, {
    status: 'resolved',
    targetPath,
    candidates: [targetPath]
  });
});

test('resolves a path wikilink without an extension when the note title contains periods', () => {
  const target = 'Collections/Cadernos/Pós Graduação. Full Cycle. MBA Arquitetura De Software/Módulos/6. DDD Domain Driven Design/6. DDD Domain Driven Design';
  const result = resolveWikilinkTarget([sourcePath, targetPath], sourcePath, target);

  assert.deepEqual(result, {
    status: 'resolved',
    targetPath,
    candidates: [targetPath]
  });
});

test('reports duplicate note titles as ambiguous when no same-folder match exists', () => {
  const duplicate = 'Collections/Other/6. DDD Domain Driven Design.md';
  const result = resolveWikilinkTarget([sourcePath, targetPath, duplicate], sourcePath, '6. DDD Domain Driven Design');

  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(new Set(result.candidates), new Set([duplicate, targetPath]));
});

test('resolves a file target when its extension is written explicitly', () => {
  const attachment = 'Collections/References/Architecture Guide.pdf';
  const result = resolveWikilinkTarget([sourcePath, attachment], sourcePath, 'Architecture Guide.pdf');

  assert.deepEqual(result, {
    status: 'resolved',
    targetPath: attachment,
    candidates: [attachment]
  });
});
