import books from '../data/prepared-books.json';

export const ENCODE_SAMPLES = [
  { id: 'alice', title: 'Alice in Wonderland', author: 'Lewis Carroll', detail: 'Complete book', file: 'samples/alice.txt', name: 'alice.txt', bytes: 151094 },
  { id: 'alice-excerpt', title: 'Alice opening excerpt', author: 'Lewis Carroll', detail: 'Short text', file: 'samples/alice-excerpt.txt', name: 'alice-excerpt.txt', bytes: 12000 },
  ...books.map(book => ({ id: book.id, title: book.title, author: book.author, detail: 'Complete short text', file: book.text, name: book.id + '.txt', bytes: book.sourceBytes })),
  { id: 'logs', title: 'Structured logs', author: 'JSON Lines', detail: 'A small, repetitive example', file: 'samples/sample-logs.jsonl', name: 'events.jsonl' },
  { id: 'unicode', title: 'A few languages', author: 'Unicode text', detail: 'Try multilingual text', file: 'samples/sample-unicode.txt', name: 'languages.txt' },
];
export const DECODE_SAMPLES = [
  { id: 'alice', title: 'Alice in Wonderland', author: 'Lewis Carroll', file: 'samples/alice-neural.nzip', name: 'alice-neural.nzip', bytes: 63048, restoredBytes: 151094 },
  ...books.map(book => ({ id: book.id, title: book.title, author: book.author, file: book.archive, name: book.id + '.nzip', bytes: book.archiveBytes, restoredBytes: book.sourceBytes })),
  { id: 'library', title: 'Five-book collection', author: 'A larger experiment', file: 'samples/library-neural.nzip', name: 'library-neural.nzip', bytes: 791134, restoredBytes: 3120899 },
];
