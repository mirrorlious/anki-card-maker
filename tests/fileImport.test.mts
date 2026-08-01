import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fileExtension,
  importFileKind,
  SUPPORTED_FILE_ACCEPT,
} from '../src/fileImport.ts';

test('recognizes supported document formats without trusting MIME alone', () => {
  assert.equal(importFileKind({ name: 'notes.MD', type: '' }), 'text');
  assert.equal(importFileKind({ name: 'book.docx', type: '' }), 'docx');
  assert.equal(importFileKind({ name: 'scan.bin', type: 'application/pdf' }), 'pdf');
  assert.equal(importFileKind({ name: 'slides.pptx', type: '' }), 'unsupported');
  assert.equal(fileExtension('archive.DATA.JSON'), 'json');
});

test('exposes the accepted extensions used by the file picker', () => {
  for (const extension of ['.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.html']) {
    assert.match(SUPPORTED_FILE_ACCEPT, new RegExp(`\\${extension}`));
  }
});
