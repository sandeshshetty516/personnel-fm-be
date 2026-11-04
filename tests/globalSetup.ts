import { MongoMemoryReplSet } from 'mongodb-memory-server';

// A replica set (not a standalone server) so multi-document transactions work in tests, as in Atlas.
export default async function globalSetup() {
  // --nounixsocket: mongod otherwise writes /tmp/mongodb-<port>.sock, which the Claude Code sandbox blocks.
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ args: ['--nounixsocket'] }],
  });
  (globalThis as Record<string, unknown>).__MONGO_REPLSET__ = replSet;
  process.env.MONGO_URI_TEST = replSet.getUri();
}
