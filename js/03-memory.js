// === Long-Term Memory System (DB, Engine, Views, UI, Prompt, Batch) ===
// 角色长期记忆的 IndexedDB 接口。
const memoryRepository = (() => {
    const backupFormat = 'uwu-character-memory';
    const schemaVersion = 1;
    const kinds = ['event', 'fact', 'code'];
    const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const isText = value => typeof value === 'string';
    const isId = value => isText(value) && value.trim().length > 0;
    const isTimestamp = value => Number.isSafeInteger(value) && value >= 0;
    const isStrength = value => Number.isFinite(value) && value >= 0 && value <= 1;
    const isBoolean = value => typeof value === 'boolean';
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isIdList = value => Array.isArray(value) && value.every(isId);
    const isTriggerList = value => Array.isArray(value) && value.every(trigger =>
        isRecord(trigger) && isId(trigger.kind) && isId(trigger.value)
    );

    function requireValid(condition, field) {
        if (!condition) throw new TypeError(`长期记忆字段无效：${field}`);
    }

    function normalizeEntry(data) {
        requireValid(isRecord(data), 'entry');
        requireValid(kinds.includes(data.kind), 'kind');
        requireValid(isId(data.title), 'title');
        const entry = { kind: data.kind, title: data.title.trim() };
        const fields = {
            summary: ['', isText],
            details: ['', isText],
            eventAt: [null, isTimestamp],
            keywords: [[], isIdList],
            people: [[], isIdList],
            places: [[], isIdList],
            objects: [[], isIdList],
            emotion: ['', isText],
            importance: [0.5, isStrength],
            baseStrength: [0.5, isStrength],
            lastRecalledAt: [null, isTimestamp],
            recallCount: [0, isTimestamp],
            pinned: [false, isBoolean],
            recallClass: ['ordinary', value => ['ordinary', 'agreement', 'core', 'evolution'].includes(value)],
            permanent: [data.kind === 'code', isBoolean],
            source: ['manual', isId],
            sourceMessageIds: [[], isIdList],
            archiveId: [null, isId],
            linkedEntryIds: [[], isIdList],
            enabled: [true, isBoolean]
        };
        if (data.kind === 'code') {
            Object.assign(fields, {
                aliases: [[], isIdList],
                meaning: ['', isText],
                responseGuidance: ['', isText],
                matchMode: ['exact_then_alias', value => ['exact', 'exact_then_alias'].includes(value)],
                triggers: [[], isTriggerList],
                priority: [0, Number.isFinite],
                expiresAt: [null, isTimestamp]
            });
        }
        for (const [name, [defaultValue, validate]] of Object.entries(fields)) {
            const value = data[name];
            if (value === undefined || (value === null && defaultValue === null)) {
                entry[name] = defaultValue;
                continue;
            }
            requireValid(validate(value), name);
            entry[name] = Array.isArray(value) ? [...new Set(value)] : value;
        }
        if (entry.triggers) {
            entry.triggers = entry.triggers.map(({ kind, value }) => ({ kind, value }));
        }
        return entry;
    }

    // 写事务锁定角色表，和角色删除使用相同的事务边界。
    function transaction(mode, operation) {
        return dexieDB.transaction(mode, dexieDB.characters, dexieDB.memoryEntries,
            dexieDB.memoryAssets, dexieDB.memoryPacks, operation);
    }

    function byCharacter(table, characterId) {
        requireValid(isId(characterId), 'characterId');
        return table.where('characterId').equals(characterId);
    }

    async function requireCharacter(characterId) {
        requireValid(isId(characterId), 'characterId');
        if (!await dexieDB.characters.get(characterId)) {
            throw new Error('长期记忆的目标角色不存在');
        }
    }

    async function get(characterId, id) {
        requireValid(isId(characterId), 'characterId');
        requireValid(isId(id), 'id');
        const entry = await dexieDB.memoryEntries.get(id);
        if (entry?.characterId === characterId) return entry;
    }

    function list(characterId, kind) {
        if (kind === undefined) return byCharacter(dexieDB.memoryEntries, characterId).toArray();
        requireValid(isId(characterId), 'characterId');
        requireValid(kinds.includes(kind), 'kind');
        return dexieDB.memoryEntries.where('[characterId+kind]').equals([characterId, kind]).toArray();
    }

    const inArchive = (entry, archiveId) => entry.archiveId == null || entry.archiveId === archiveId;

    async function listForArchive(characterId, archiveId, kind) {
        return (await list(characterId, kind)).filter(entry => inArchive(entry, archiveId));
    }

    async function validateLinks(entry) {
        if (entry.linkedEntryIds.length === 0) return;
        const linkedEntries = await dexieDB.memoryEntries.bulkGet(entry.linkedEntryIds);
        requireValid(linkedEntries.every(link =>
            link?.characterId === entry.characterId && link.id !== entry.id
        ), 'linkedEntryIds');
    }

    async function create(characterId, data) {
        const now = Date.now();
        const entry = {
            ...normalizeEntry(data), id: `mem_${crypto.randomUUID()}`, characterId,
            createdAt: now, updatedAt: now, packId: null
        };
        return transaction('rw', async () => {
            await requireCharacter(characterId);
            await validateLinks(entry);
            await dexieDB.memoryEntries.add(entry);
            return entry;
        });
    }

    async function update(characterId, id, changes) {
        requireValid(isRecord(changes), 'changes');
        return transaction('rw', async () => {
            const current = await get(characterId, id);
            if (!current) return;
            await requireCharacter(characterId);
            const entry = {
                ...current, ...normalizeEntry({ ...current, ...changes, kind: current.kind }),
                updatedAt: Date.now()
            };
            await validateLinks(entry);
            await dexieDB.memoryEntries.put(entry);
            return entry;
        });
    }

    async function remove(characterId, id) {
        return transaction('rw', async () => {
            const entry = await get(characterId, id);
            if (!entry) return false;
            await dexieDB.memoryAssets.where('[characterId+entryId]').equals([characterId, id]).delete();
            await byCharacter(dexieDB.memoryEntries, characterId)
                .filter(record => record.linkedEntryIds.includes(id))
                .modify(record => {
                    record.linkedEntryIds = record.linkedEntryIds.filter(linkId => linkId !== id);
                    record.updatedAt = Date.now();
                });
            if (entry.packId) {
                await dexieDB.memoryPacks.where('[characterId+packId]').equals([characterId, entry.packId])
                    .modify(pack => { pack.entryIds = pack.entryIds.filter(entryId => entryId !== id); });
            }
            await dexieDB.memoryEntries.delete(id);
            return true;
        });
    }

    function memoryTables() {
        return [dexieDB.memoryEntries, dexieDB.memoryAssets, dexieDB.memoryPacks];
    }

    async function clearCharacter(characterId) {
        for (const table of memoryTables()) {
            await byCharacter(table, characterId).delete();
        }
    }

    function deleteCharacter(characterId) {
        return transaction('rw', async () => {
            await clearCharacter(characterId);
            await dexieDB.characters.delete(characterId);
        });
    }

    // 在旧版全量恢复重建角色表后执行，随外层写事务一起提交。
    function pruneDeletedCharacters() {
        return transaction('rw', async () => {
            const retainedIds = new Set(await dexieDB.characters.toCollection().primaryKeys());
            for (const table of memoryTables()) {
                const characterIds = await table.orderBy('characterId').uniqueKeys();
                const deletedIds = characterIds.filter(id => !retainedIds.has(id));
                if (deletedIds.length > 0) await table.where('characterId').anyOf(deletedIds).delete();
            }
        });
    }

    function getStorageSize() {
        const encoder = new TextEncoder();
        return transaction('r', async () => {
            let size = 0;
            for (const table of memoryTables()) {
                await table.each(({ blob, ...metadata }) => {
                    size += (blob?.size ?? 0) + encoder.encode(JSON.stringify(metadata)).length;
                });
            }
            return size;
        });
    }

    function encodeBlob(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
            reader.readAsDataURL(blob);
        });
    }

    async function readSnapshot(characterId) {
        await requireCharacter(characterId);
        const [entries, assets, packs] = await Promise.all(
            memoryTables().map(table => byCharacter(table, characterId).toArray())
        );
        return { entries, assets, packs, characterId };
    }

    async function encodeSnapshot(snapshot) {
        const assets = [];
        for (const { blob, ...metadata } of snapshot.assets) {
            assets.push({ ...metadata, data: await encodeBlob(blob) });
        }
        return { ...snapshot, assets, format: backupFormat, schemaVersion };
    }

    async function exportBackup(characterId) {
        const snapshot = await transaction('r', () => readSnapshot(characterId));
        return encodeSnapshot(snapshot);
    }

    async function exportAllBackups() {
        const snapshots = await transaction('r', async () => {
            const ids = await dexieDB.characters.toCollection().primaryKeys();
            return Promise.all(ids.map(readSnapshot));
        });
        const backups = [];
        for (const snapshot of snapshots) backups.push(await encodeSnapshot(snapshot));
        return backups;
    }

    function hasImageSignature(binary, mimeType) {
        const signatures = {
            'image/png': ['\x89PNG\r\n\x1a\n'],
            'image/jpeg': ['\xff\xd8\xff'],
            'image/gif': ['GIF87a', 'GIF89a'],
            'image/webp': ['RIFF']
        };
        return signatures[mimeType].some(signature => binary.startsWith(signature))
            && (mimeType !== 'image/webp' || binary.slice(8, 12) === 'WEBP');
    }

    function validateBackupRecord(record, characterId, ids, type) {
        requireValid(isRecord(record) && isId(record.id) && record.characterId === characterId, type);
        requireValid(!ids.has(record.id), `${type}.id`);
        ids.add(record.id);
    }

    async function readBackup(characterId, backup) {
        requireValid(isRecord(backup) && backup.format === backupFormat
            && backup.schemaVersion === schemaVersion && backup.characterId === characterId, 'backup');
        requireValid([backup.entries, backup.assets, backup.packs].every(Array.isArray), 'backup.tables');

        const packRecordIds = new Set();
        const packsById = new Map();
        for (const record of backup.packs) {
            validateBackupRecord(record, characterId, packRecordIds, 'pack');
            const { id, packId, packVersion, packName, importedAt, contentHash, entryIds } = record;
            requireValid(isId(packId) && !packsById.has(packId) && isIdList(entryIds), 'pack.packId');
            requireValid((isId(packVersion) || isTimestamp(packVersion)) && isText(packName)
                && isTimestamp(importedAt) && isId(contentHash), 'pack.metadata');
            packsById.set(packId, { id, characterId, packId, packVersion, packName,
                importedAt, contentHash, entryIds: [...entryIds] });
        }

        const entryIds = new Set();
        const entries = backup.entries.map(record => {
            validateBackupRecord(record, characterId, entryIds, 'entry');
            const { id, createdAt, updatedAt, packId = null } = record;
            requireValid(isTimestamp(createdAt) && isTimestamp(updatedAt), 'entry.timestamp');
            requireValid(packId === null || packsById.has(packId), 'entry.packId');
            const entry = { ...normalizeEntry(record), id, characterId, createdAt, updatedAt, packId };
            if (record.packEntryId !== undefined) {
                requireValid(packId !== null && isId(record.packEntryId), 'entry.packEntryId');
                entry.packEntryId = record.packEntryId;
            }
            return entry;
        });
        const entriesById = new Map(entries.map(entry => [entry.id, entry]));
        for (const entry of entries) {
            requireValid(entry.linkedEntryIds.every(id => id !== entry.id && entriesById.has(id)), 'linkedEntryIds');
        }
        const membersByPackId = new Map(Array.from(packsById.keys(), id => [id, new Set()]));
        for (const entry of entries) {
            if (entry.packId) membersByPackId.get(entry.packId).add(entry.id);
        }
        for (const pack of packsById.values()) {
            const members = membersByPackId.get(pack.packId);
            requireValid(pack.entryIds.length === members.size
                && new Set(pack.entryIds).size === members.size
                && pack.entryIds.every(id => members.has(id)), 'pack.entryIds');
        }

        const assetIds = new Set();
        const assets = [];
        for (const record of backup.assets) {
            validateBackupRecord(record, characterId, assetIds, 'asset');
            const { id, entryId, mimeType, fileName, sha256, data, createdAt, packId = null } = record;
            requireValid(entriesById.has(entryId) && entriesById.get(entryId).packId === packId, 'asset.entryId');
            requireValid(imageTypes.includes(mimeType) && isId(fileName) && isTimestamp(createdAt)
                && isText(sha256) && /^[a-f0-9]{64}$/.test(sha256) && isId(data), 'asset.metadata');
            const binary = atob(data);
            requireValid(hasImageSignature(binary, mimeType), 'asset.mimeType');
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index++) {
                bytes[index] = binary.charCodeAt(index);
            }
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
            const actualHash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
            requireValid(actualHash === sha256, 'asset.sha256');
            assets.push({ id, characterId, entryId, mimeType, fileName, sha256, createdAt, packId,
                blob: new Blob([bytes], { type: mimeType }) });
        }
        return [entries, assets, [...packsById.values()]];
    }

    async function remapRecords(characterId, records, archiveIds = new Map()) {
        const [entries, assets, packs] = records;
        const encoder = new TextEncoder();
        async function mappedId(prefix, record) {
            const identity = encoder.encode(JSON.stringify([characterId, record.characterId, record.id]));
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', identity));
            return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        }
        const mappedIds = new Map(await Promise.all(entries.map(async entry => [entry.id, await mappedId('mem_', entry)])));
        return Promise.all([
            entries.map(entry => ({ ...entry, characterId, id: mappedIds.get(entry.id), sourceMessageIds: [],
                archiveId: entry.archiveId ? (archiveIds.get(entry.archiveId) ?? `unmapped:${entry.characterId}:${entry.archiveId}`) : null,
                linkedEntryIds: entry.linkedEntryIds.map(id => mappedIds.get(id)) })),
            Promise.all(assets.map(async asset => ({ ...asset, characterId,
                id: await mappedId('asset_', asset), entryId: mappedIds.get(asset.entryId) }))),
            Promise.all(packs.map(async pack => ({ ...pack, characterId,
                id: await mappedId('pack_', pack), entryIds: pack.entryIds.map(id => mappedIds.get(id)) })))
        ]);
    }

    function mergeBackupRecords(snapshot, incoming, strategy) {
        const [entries, assets, packs] = incoming;
        const existing = new Map(snapshot.entries.map(entry => [entry.id, entry]));
        const signature = entry => entry.packId && entry.packEntryId ? JSON.stringify([entry.packId, entry.packEntryId]) : null;
        const packEntries = new Map(snapshot.entries.filter(signature).map(entry => [signature(entry), entry.id]));
        const aliases = new Map(entries.map(entry => [entry.id, packEntries.get(signature(entry)) || entry.id]));
        let added = 0;
        let merged = 0;
        let skipped = 0;

        for (const entry of entries) {
            const id = aliases.get(entry.id);
            const old = existing.get(id);
            const links = entry.linkedEntryIds.map(link => aliases.get(link)).filter(link => link && link !== id);
            if (!old) {
                added++;
                existing.set(id, { ...entry, id, linkedEntryIds: [...new Set(links)] });
                continue;
            }
            if (strategy === 'skip' || old.kind !== entry.kind || (old.archiveId ?? null) !== entry.archiveId) {
                skipped++;
                continue;
            }
            const united = { ...old, updatedAt: Date.now() };
            for (const key of ['summary', 'details', 'meaning', 'responseGuidance']) {
                if (!united[key] && entry[key]) united[key] = entry[key];
            }
            for (const key of ['keywords', 'people', 'places', 'objects', 'aliases', 'sourceMessageIds']) {
                if (Array.isArray(united[key])) united[key] = [...new Set([...united[key], ...(entry[key] || [])])];
            }
            united.linkedEntryIds = [...new Set([...old.linkedEntryIds, ...links])];
            if (old.kind === 'code') {
                united.triggers = [...new Map([...old.triggers, ...entry.triggers]
                    .map(trigger => [JSON.stringify(trigger), trigger])).values()];
            }
            existing.set(id, united);
            merged++;
        }

        const localIds = new Set(snapshot.entries.map(entry => entry.id));
        const localAssets = new Map(snapshot.assets.map(asset => [asset.id, asset]));
        const hashes = new Set(snapshot.assets.map(asset => JSON.stringify([asset.entryId, asset.sha256])));
        for (const asset of assets) {
            const entryId = aliases.get(asset.entryId);
            const entry = existing.get(entryId);
            const key = JSON.stringify([entryId, asset.sha256]);
            if (!entry || localAssets.has(asset.id) || hashes.has(key) || (strategy === 'skip' && localIds.has(entryId))) continue;
            localAssets.set(asset.id, { ...asset, entryId, packId: entry.packId });
            hashes.add(key);
        }

        const allPacks = new Map(snapshot.packs.map(pack => [pack.packId, { ...pack, entryIds: [] }]));
        const usedPackIds = new Set([...existing.values()].map(entry => entry.packId).filter(Boolean));
        for (const pack of packs) {
            if (!allPacks.has(pack.packId) && usedPackIds.has(pack.packId)) allPacks.set(pack.packId, { ...pack, entryIds: [] });
        }
        for (const entry of existing.values()) {
            if (entry.packId) allPacks.get(entry.packId)?.entryIds.push(entry.id);
        }
        return { records: [[...existing.values()], [...localAssets.values()], [...allPacks.values()]], added, merged, skipped };
    }

    async function writeRecords(characterId, records) {
        await requireCharacter(characterId);
        await clearCharacter(characterId);
        for (const [index, table] of memoryTables().entries()) {
            // add 会在主键冲突时回滚，保护其他角色。
            if (records[index].length) await table.bulkAdd(records[index]);
        }
        const [entries, assets, packs] = records;
        return { entries: entries.length, assets: assets.length, packs: packs.length };
    }

    // 完整快照替换目标角色的记忆，映射其他角色时须由调用方显式确认。
    async function restoreBackup(characterId, backup, { remap = false, strategy = 'replace' } = {}) {
        requireValid(isId(characterId), 'characterId');
        requireValid(['replace', 'merge', 'skip'].includes(strategy), 'strategy');
        const source = remap ? backup?.characterId : characterId;
        requireValid(isId(source), 'backup.characterId');
        const records = await readBackup(source, backup);
        const mapped = source === characterId ? records : await remapRecords(characterId, records);
        return transaction('rw', async () => {
            if (strategy === 'replace') return writeRecords(characterId, mapped);
            const combined = mergeBackupRecords(await readSnapshot(characterId), mapped, strategy);
            const counts = await writeRecords(characterId, combined.records);
            return { ...counts, added: combined.added, merged: combined.merged, skipped: combined.skipped };
        });
    }

    async function prepareCardBackup(characterId, backup, archiveIds) {
        requireValid(isId(backup?.characterId), 'backup.characterId');
        const records = await readBackup(backup.characterId, backup);
        return remapRecords(characterId, records, archiveIds);
    }

    function clearSavedMemories(characterId) {
        return transaction('rw', () => writeRecords(characterId, [[], [], []]));
    }

    async function prepareAllBackups(backups, roleIds) {
        requireValid(Array.isArray(backups), 'memoryBackups');
        const seen = new Set();
        const prepared = new Map();
        for (const backup of backups) {
            const id = backup?.characterId;
            requireValid(isId(id) && !seen.has(id), 'memoryBackups.characterId');
            seen.add(id);
            const records = await readBackup(id, backup);
            if (roleIds.has(id)) prepared.set(id, records);
        }
        return { prepared, missing: seen.size - prepared.size };
    }

    function importAllBackups(prepared) {
        return transaction('rw', async () => {
            for (const [characterId, records] of prepared) await writeRecords(characterId, records);
        });
    }

    function getPack(characterId, packId) {
        requireValid(isId(characterId) && isId(packId), 'packId');
        return dexieDB.memoryPacks.where('[characterId+packId]').equals([characterId, packId]).first();
    }

    async function getPackMembers(characterId, packId) {
        const pack = await getPack(characterId, packId);
        const entries = pack ? await dexieDB.memoryEntries.bulkGet(pack.entryIds) : [];
        return { pack, entries: entries.filter(entry => entry?.characterId === characterId && entry.packId === packId) };
    }

    function getPackDuplicates(characterId, preview) {
        return transaction('r', async () => {
            const { entries } = await getPackMembers(characterId, preview.packId);
            const known = new Set(entries.map(entry => entry.packEntryId));
            return preview.entries.filter(item => known.has(item.key)).length;
        });
    }

    function mergeCode(current, incoming) {
        const triggers = new Map([...current.triggers, ...incoming.triggers].map(trigger => [JSON.stringify(trigger), trigger]));
        return {
            ...incoming, ...current,
            meaning: current.meaning || incoming.meaning,
            responseGuidance: current.responseGuidance || incoming.responseGuidance,
            aliases: [...new Set([...current.aliases, ...incoming.aliases])],
            keywords: [...new Set([...current.keywords, ...incoming.keywords])],
            triggers: [...triggers.values()]
        };
    }

    function importPack(characterId, preview, strategy = 'skip') {
        requireValid(['skip', 'merge', 'replace'].includes(strategy), 'strategy');
        return transaction('rw', async () => {
            await requireCharacter(characterId);
            const { pack, entries } = await getPackMembers(characterId, preview.packId);
            const byKey = new Map(entries.map(entry => [entry.packEntryId, entry]));
            const entryIds = new Set(entries.map(entry => entry.id));
            const now = Date.now();
            const result = { imported: 0, skipped: 0, failed: 0 };
            for (const item of preview.entries) {
                const current = byKey.get(item.key);
                if (current && strategy === 'skip') {
                    result.skipped++;
                    continue;
                }
                const incoming = normalizeEntry(item.entry);
                const entry = {
                    ...(current && strategy === 'merge' ? mergeCode(current, incoming) : { ...current, ...incoming }),
                    characterId, id: current?.id ?? `mem_${crypto.randomUUID()}`, packId: preview.packId,
                    archiveId: current?.archiveId ?? null, packEntryId: item.key, createdAt: current?.createdAt ?? now, updatedAt: now
                };
                if (current && strategy === 'replace') {
                    entry.linkedEntryIds = current.linkedEntryIds;
                    await dexieDB.memoryAssets.where('[characterId+entryId]').equals([characterId, entry.id]).delete();
                }
                await dexieDB.memoryEntries.put(entry);
                const existingAssets = await dexieDB.memoryAssets.where('[characterId+entryId]').equals([characterId, entry.id]).toArray();
                const hashes = new Set(existingAssets.map(asset => asset.sha256));
                for (const asset of item.assets) {
                    if (hashes.has(asset.sha256)) continue;
                    await dexieDB.memoryAssets.add({ ...asset, id: `asset_${crypto.randomUUID()}`,
                        characterId, entryId: entry.id, packId: preview.packId, createdAt: now });
                    hashes.add(asset.sha256);
                }
                entryIds.add(entry.id);
                result.imported++;
            }
            if (result.imported) {
                await dexieDB.memoryPacks.put({
                    id: pack?.id ?? `pack_${crypto.randomUUID()}`, characterId, packId: preview.packId,
                    packName: preview.packName, packVersion: preview.packVersion, contentHash: preview.contentHash,
                    entryIds: [...entryIds], importedAt: now
                });
            }
            return result;
        });
    }

    function getPackExport(characterId, selected) {
        requireValid(isIdList(selected), 'entryIds');
        return transaction('r', async () => {
            await requireCharacter(characterId);
            const requested = new Set(selected);
            const entries = (await list(characterId, 'code')).filter(entry => requested.has(entry.id));
            const assets = [];
            for (const entry of entries) {
                assets.push(...await dexieDB.memoryAssets.where('[characterId+entryId]').equals([characterId, entry.id]).toArray());
            }
            const packIds = new Set(entries.map(entry => entry.packId));
            const packs = (await byCharacter(dexieDB.memoryPacks, characterId).toArray()).filter(pack => packIds.has(pack.packId));
            return { entries, assets, packs };
        });
    }

    function recordRecall(characterId, hits) {
        return transaction('rw', async () => {
            const now = Date.now();
            const hitIds = new Set(hits.map(h => h?.entry?.id).filter(Boolean));
            const linkedBoostIds = new Set();
            for (const hit of hits) {
                if (!hit?.entry?.id) continue;
                const isDirect = Boolean(hit.explicit || (Number.isFinite(hit.score) && hit.score >= 0.75));
                if (isDirect && Array.isArray(hit.entry.linkedEntryIds)) {
                    for (const lid of hit.entry.linkedEntryIds) {
                        if (lid && !hitIds.has(lid)) linkedBoostIds.add(lid);
                    }
                }
                await dexieDB.memoryEntries.where('id').equals(hit.entry.id)
                    .filter(entry => entry.characterId === characterId).modify(entry => {
                        entry.recallCount = (entry.recallCount || 0) + 1;
                        const prevRecalled = entry.lastRecalledAt || 0;
                        // 直接强命中立刻刷新记忆时间并大幅回暖；后台顺带召回间隔超过 6 小时再刷新时间，温和巩固
                        if (isDirect || (now - prevRecalled > 6 * 3600 * 1000)) {
                            entry.lastRecalledAt = now;
                        }
                        if (entry.kind !== 'code' && !entry.pinned && !entry.permanent) {
                            const currentStrength = Number.isFinite(entry.baseStrength) ? entry.baseStrength : 0.5;
                            const delta = isDirect ? 0.16 : 0.05;
                            const cap = isDirect ? 0.98 : 0.95;
                            entry.baseStrength = Math.min(cap, Number((currentStrength + delta).toFixed(2)));
                        }
                    });
            }
            // 关联记忆联动回暖：直接聊到某件事时，绑定的关联记忆也轻微浮现
            for (const lid of linkedBoostIds) {
                await dexieDB.memoryEntries.where('id').equals(lid)
                    .filter(entry => entry.characterId === characterId && entry.kind !== 'code' && !entry.pinned && !entry.permanent)
                    .modify(entry => {
                        const currentStrength = Number.isFinite(entry.baseStrength) ? entry.baseStrength : 0.5;
                        entry.baseStrength = Math.min(0.92, Number((currentStrength + 0.06).toFixed(2)));
                    });
            }
        });
    }

    function saveCode(characterId, id, data, asset, copyFrom) {
        return transaction('rw', async () => {
            const triggers = asset ? [
                ...data.triggers.filter(trigger => trigger.kind !== 'imageSha256'), { kind: 'imageSha256', value: asset.sha256 }
            ] : data.triggers;
            const record = { ...data, kind: 'code', triggers };
            const entry = id ? await update(characterId, id, record) : await create(characterId, record);
            if (!entry || entry.kind !== 'code') throw new Error('暗号不存在');
            let assets = [];
            if (asset) {
                await dexieDB.memoryAssets.where('[characterId+entryId]').equals([characterId, entry.id]).delete();
                assets = [asset];
            } else if (copyFrom) {
                assets = await dexieDB.memoryAssets.where('[characterId+entryId]').equals([characterId, copyFrom]).toArray();
            }
            for (const image of assets) {
                await dexieDB.memoryAssets.add({ ...image, id: `asset_${crypto.randomUUID()}`,
                    characterId, entryId: entry.id, packId: entry.packId, createdAt: Date.now() });
            }
            return entry;
        });
    }

    function shareCode(fromCharacterId, targetCharacterId, id) {
        if (fromCharacterId === targetCharacterId) throw new Error('请选择另一个角色');
        return transaction('rw', async () => {
            await requireCharacter(fromCharacterId);
            const source = await get(fromCharacterId, id);
            if (source?.kind !== 'code') throw new Error('暗号不存在');
            const entry = await create(targetCharacterId, {
                ...source, archiveId: null, linkedEntryIds: [], sourceMessageIds: [], lastRecalledAt: null, recallCount: 0, source: 'shared'
            });
            const assets = await dexieDB.memoryAssets.where('[characterId+entryId]').equals([fromCharacterId, id]).toArray();
            for (const asset of assets) {
                await dexieDB.memoryAssets.add({ ...asset, id: `asset_${crypto.randomUUID()}`,
                    characterId: targetCharacterId, entryId: entry.id, packId: null, createdAt: Date.now() });
            }
            return entry;
        });
    }

    return { create, update, delete: remove, shareCode, list, inArchive, listForArchive, get, exportBackup, restoreBackup, clearSavedMemories, exportAllBackups, prepareAllBackups, importAllBackups, prepareCardBackup, saveCode, recordRecall,
        validateEntry: normalizeEntry, hasImageSignature, importPack, getPackDuplicates, getPackExport,
        deleteCharacter, pruneDeletedCharacters, getStorageSize };
})();
;
!function(f){typeof module!='undefined'&&typeof exports=='object'?module.exports=f():typeof define!='undefined'&&define.amd?define(f):(typeof self!='undefined'?self:this).fflate=f()}(function(){var _e={};"use strict";var t=(typeof module!='undefined'&&typeof exports=='object'?function(_f){"use strict";var e,t=";var __w=require('worker_threads');__w.parentPort.on('message',function(m){onmessage({data:m})}),postMessage=function(m,t){__w.parentPort.postMessage(m,t)},close=process.exit;self=global";try{e=require("worker_threads").Worker}catch(e){}exports.default=e?function(r,n,o,a,s){var u=!1,i=new e(r+t,{eval:!0}).on("error",(function(e){return s(e,null)})).on("message",(function(e){return s(null,e)})).on("exit",(function(e){e&&!u&&s(Error("exited with code "+e),null)}));return i.postMessage(o,a),i.terminate=function(){return u=!0,e.prototype.terminate.call(i)},i}:function(e,t,r,n,o){setImmediate((function(){return o(Error("async operations unsupported - update to Node 12+ (or Node 10-11 with the --experimental-worker CLI flag)"),null)}));var a=function(){};return{terminate:a,postMessage:a}};return _f}:function(_f){"use strict";var e={};_f.default=function(r,t,s,a,n){var o=new Worker(e[t]||(e[t]=URL.createObjectURL(new Blob([r+';addEventListener("error",function(e){e=e.error;postMessage({$e$:[e.message,e.code,e.stack]})})'],{type:"text/javascript"}))));return o.onmessage=function(e){var r=e.data,t=r.$e$;if(t){var s=Error(t[0]);s.code=t[1],s.stack=t[2],n(s,null)}else n(null,r)},o.postMessage(s,a),o};return _f})({}),n=Uint8Array,r=Uint16Array,e=Int32Array,i=new n([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),o=new n([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),s=new n([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),a=function(t,n){for(var i=new r(31),o=0;o<31;++o)i[o]=n+=1<<t[o-1];var s=new e(i[30]);for(o=1;o<30;++o)for(var a=i[o];a<i[o+1];++a)s[a]=a-i[o]<<5|o;return{b:i,r:s}},u=a(i,2),h=u.b,f=u.r;h[28]=258,f[258]=28;for(var l=a(o,0),c=l.b,p=l.r,v=new r(32768),d=0;d<32768;++d){var g=(43690&d)>>1|(21845&d)<<1;v[d]=((65280&(g=(61680&(g=(52428&g)>>2|(13107&g)<<2))>>4|(3855&g)<<4))>>8|(255&g)<<8)>>1}var y=function(t,n,e){for(var i=t.length,o=0,s=new r(n);o<i;++o)t[o]&&++s[t[o]-1];var a,u=new r(n);for(o=1;o<n;++o)u[o]=u[o-1]+s[o-1]<<1;if(e){a=new r(1<<n);var h=15-n;for(o=0;o<i;++o)if(t[o])for(var f=o<<4|t[o],l=n-t[o],c=u[t[o]-1]++<<l,p=c|(1<<l)-1;c<=p;++c)a[v[c]>>h]=f}else for(a=new r(i),o=0;o<i;++o)t[o]&&(a[o]=v[u[t[o]-1]++]>>15-t[o]);return a},m=new n(288);for(d=0;d<144;++d)m[d]=8;for(d=144;d<256;++d)m[d]=9;for(d=256;d<280;++d)m[d]=7;for(d=280;d<288;++d)m[d]=8;var b=new n(32);for(d=0;d<32;++d)b[d]=5;var w=y(m,9,0),x=y(m,9,1),z=y(b,5,0),k=y(b,5,1),M=function(t){for(var n=t[0],r=1;r<t.length;++r)t[r]>n&&(n=t[r]);return n},S=function(t,n,r){var e=n/8|0;return(t[e]|t[e+1]<<8)>>(7&n)&r},A=function(t,n){var r=n/8|0;return(t[r]|t[r+1]<<8|t[r+2]<<16)>>(7&n)},T=function(t){return(t+7)/8|0},D=function(t,r,e){return(null==r||r<0)&&(r=0),(null==e||e>t.length)&&(e=t.length),new n(t.subarray(r,e))};_e.FlateErrorCode={UnexpectedEOF:0,InvalidBlockType:1,InvalidLengthLiteral:2,InvalidDistance:3,StreamFinished:4,NoStreamHandler:5,InvalidHeader:6,NoCallback:7,InvalidUTF8:8,ExtraFieldTooLong:9,InvalidDate:10,FilenameTooLong:11,StreamFinishing:12,InvalidZipData:13,UnknownCompressionMethod:14};var C=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],I=function(t,n,r){var e=Error(n||C[t]);if(e.code=t,Error.captureStackTrace&&Error.captureStackTrace(e,I),!r)throw e;return e},U=function(t,r,e,a){var u=t.length,f=a?a.length:0;if(!u||r.f&&!r.l)return e||new n(0);var l=!e,p=l||2!=r.i,v=r.i;l&&(e=new n(3*u));var d=function(t){var r=e.length;if(t>r){var i=new n(Math.max(2*r,t));i.set(e),e=i}},g=r.f||0,m=r.p||0,b=r.b||0,w=r.l,z=r.d,C=r.m,U=r.n,F=8*u;do{if(!w){g=S(t,m,1);var E=S(t,m+1,3);if(m+=3,!E){var Z=t[(J=T(m)+4)-4]|t[J-3]<<8,q=J+Z;if(q>u){v&&I(0);break}p&&d(b+Z),e.set(t.subarray(J,q),b),r.b=b+=Z,r.p=m=8*q,r.f=g;continue}if(1==E)w=x,z=k,C=9,U=5;else if(2==E){var O=S(t,m,31)+257,G=S(t,m+10,15)+4,L=O+S(t,m+5,31)+1;m+=14;for(var H=new n(L),j=new n(19),N=0;N<G;++N)j[s[N]]=S(t,m+3*N,7);m+=3*G;var P=M(j),B=(1<<P)-1,Y=y(j,P,1);for(N=0;N<L;){var J,K=Y[S(t,m,B)];if(m+=15&K,(J=K>>4)<16)H[N++]=J;else{var Q=0,R=0;for(16==J?(R=3+S(t,m,3),m+=2,Q=H[N-1]):17==J?(R=3+S(t,m,7),m+=3):18==J&&(R=11+S(t,m,127),m+=7);R--;)H[N++]=Q}}var V=H.subarray(0,O),W=H.subarray(O);C=M(V),U=M(W),w=y(V,C,1),z=y(W,U,1)}else I(1);if(m>F){v&&I(0);break}}p&&d(b+131072);for(var X=(1<<C)-1,$=(1<<U)-1,_=m;;_=m){var tt=(Q=w[A(t,m)&X])>>4;if((m+=15&Q)>F){v&&I(0);break}if(Q||I(2),tt<256)e[b++]=tt;else{if(256==tt){_=m,w=null;break}var nt=tt-254;tt>264&&(nt=S(t,m,(1<<(it=i[N=tt-257]))-1)+h[N],m+=it);var rt=z[A(t,m)&$],et=rt>>4;if(rt||I(3),m+=15&rt,W=c[et],et>3){var it=o[et];W+=A(t,m)&(1<<it)-1,m+=it}if(m>F){v&&I(0);break}p&&d(b+131072);var ot=b+nt;if(b<W){var st=f-W,at=Math.min(W,ot);for(st+b<0&&I(3);b<at;++b)e[b]=a[st+b]}for(;b<ot;++b)e[b]=e[b-W]}}r.l=w,r.p=_,r.b=b,r.f=g,w&&(g=1,r.m=C,r.d=z,r.n=U)}while(!g);return b!=e.length&&l?D(e,0,b):e.subarray(0,b)},F=function(t,n,r){var e=n/8|0;t[e]|=r<<=7&n,t[e+1]|=r>>8},E=function(t,n,r){var e=n/8|0;t[e]|=r<<=7&n,t[e+1]|=r>>8,t[e+2]|=r>>16},Z=function(t,e){for(var i=[],o=0;o<t.length;++o)t[o]&&i.push({s:o,f:t[o]});var s=i.length,a=i.slice();if(!s)return{t:N,l:0};if(1==s){var u=new n(i[0].s+1);return u[i[0].s]=1,{t:u,l:1}}i.sort((function(t,n){return t.f-n.f})),i.push({s:-1,f:25001});var h=i[0],f=i[1],l=0,c=1,p=2;for(i[0]={s:-1,f:h.f+f.f,l:h,r:f};c!=s-1;)h=i[i[l].f<i[p].f?l++:p++],f=i[l!=c&&i[l].f<i[p].f?l++:p++],i[c++]={s:-1,f:h.f+f.f,l:h,r:f};var v=a[0].s;for(o=1;o<s;++o)a[o].s>v&&(v=a[o].s);var d=new r(v+1),g=q(i[c-1],d,0);if(g>e){o=0;var y=0,m=g-e,b=1<<m;for(a.sort((function(t,n){return d[n.s]-d[t.s]||t.f-n.f}));o<s;++o){var w=a[o].s;if(!(d[w]>e))break;y+=b-(1<<g-d[w]),d[w]=e}for(y>>=m;y>0;){var x=a[o].s;d[x]<e?y-=1<<e-d[x]++-1:++o}for(;o>=0&&y;--o){var z=a[o].s;d[z]==e&&(--d[z],++y)}g=e}return{t:new n(d),l:g}},q=function(t,n,r){return-1==t.s?Math.max(q(t.l,n,r+1),q(t.r,n,r+1)):n[t.s]=r},O=function(t){for(var n=t.length;n&&!t[--n];);for(var e=new r(++n),i=0,o=t[0],s=1,a=function(t){e[i++]=t},u=1;u<=n;++u)if(t[u]==o&&u!=n)++s;else{if(!o&&s>2){for(;s>138;s-=138)a(32754);s>2&&(a(s>10?s-11<<5|28690:s-3<<5|12305),s=0)}else if(s>3){for(a(o),--s;s>6;s-=6)a(8304);s>2&&(a(s-3<<5|8208),s=0)}for(;s--;)a(o);s=1,o=t[u]}return{c:e.subarray(0,i),n:n}},G=function(t,n){for(var r=0,e=0;e<n.length;++e)r+=t[e]*n[e];return r},L=function(t,n,r){var e=r.length,i=T(n+2);t[i]=255&e,t[i+1]=e>>8,t[i+2]=255^t[i],t[i+3]=255^t[i+1];for(var o=0;o<e;++o)t[i+o+4]=r[o];return 8*(i+4+e)},H=function(t,n,e,a,u,h,f,l,c,p,v){F(n,v++,e),++u[256];for(var d=Z(u,15),g=d.t,x=d.l,k=Z(h,15),M=k.t,S=k.l,A=O(g),T=A.c,D=A.n,C=O(M),I=C.c,U=C.n,q=new r(19),H=0;H<T.length;++H)++q[31&T[H]];for(H=0;H<I.length;++H)++q[31&I[H]];for(var j=Z(q,7),N=j.t,P=j.l,B=19;B>4&&!N[s[B-1]];--B);var Y,J,K,Q,R=p+5<<3,V=G(u,m)+G(h,b)+f,W=G(u,g)+G(h,M)+f+14+3*B+G(q,N)+2*q[16]+3*q[17]+7*q[18];if(c>=0&&R<=V&&R<=W)return L(n,v,t.subarray(c,c+p));if(F(n,v,1+(W<V)),v+=2,W<V){Y=y(g,x,0),J=g,K=y(M,S,0),Q=M;var X=y(N,P,0);for(F(n,v,D-257),F(n,v+5,U-1),F(n,v+10,B-4),v+=14,H=0;H<B;++H)F(n,v+3*H,N[s[H]]);v+=3*B;for(var $=[T,I],_=0;_<2;++_){var tt=$[_];for(H=0;H<tt.length;++H)F(n,v,X[rt=31&tt[H]]),v+=N[rt],rt>15&&(F(n,v,tt[H]>>5&127),v+=tt[H]>>12)}}else Y=w,J=m,K=z,Q=b;for(H=0;H<l;++H){var nt=a[H];if(nt>255){var rt;E(n,v,Y[257+(rt=nt>>18&31)]),v+=J[rt+257],rt>7&&(F(n,v,nt>>23&31),v+=i[rt]);var et=31&nt;E(n,v,K[et]),v+=Q[et],et>3&&(E(n,v,nt>>5&8191),v+=o[et])}else E(n,v,Y[nt]),v+=J[nt]}return E(n,v,Y[256]),v+J[256]},j=new e([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),N=new n(0),P=function(t,s,a,u,h,l){var c=l.z||t.length,v=new n(u+c+5*(1+Math.ceil(c/7e3))+h),d=v.subarray(u,v.length-h),g=l.l,y=7&(l.r||0);if(s){y&&(d[0]=l.r>>3);for(var m=j[s-1],b=m>>13,w=8191&m,x=(1<<a)-1,z=l.p||new r(32768),k=l.h||new r(x+1),M=Math.ceil(a/3),S=2*M,A=function(n){return(t[n]^t[n+1]<<M^t[n+2]<<S)&x},C=new e(25e3),I=new r(288),U=new r(32),F=0,E=0,Z=l.i||0,q=0,O=l.w||0,G=0;Z+2<c;++Z){var N=A(Z),P=32767&Z,B=k[N];if(z[P]=B,k[N]=P,O<=Z){var Y=c-Z;if((F>7e3||q>24576)&&(Y>423||!g)){y=H(t,d,0,C,I,U,E,q,G,Z-G,y),q=F=E=0,G=Z;for(var J=0;J<286;++J)I[J]=0;for(J=0;J<30;++J)U[J]=0}var K=2,Q=0,R=w,V=P-B&32767;if(Y>2&&N==A(Z-V))for(var W=Math.min(b,Y)-1,X=Math.min(32767,Z),$=Math.min(258,Y);V<=X&&--R&&P!=B;){if(t[Z+K]==t[Z+K-V]){for(var _=0;_<$&&t[Z+_]==t[Z+_-V];++_);if(_>K){if(K=_,Q=V,_>W)break;var tt=Math.min(V,_-2),nt=0;for(J=0;J<tt;++J){var rt=Z-V+J&32767,et=rt-z[rt]&32767;et>nt&&(nt=et,B=rt)}}}V+=(P=B)-(B=z[P])&32767}if(Q){C[q++]=268435456|f[K]<<18|p[Q];var it=31&f[K],ot=31&p[Q];E+=i[it]+o[ot],++I[257+it],++U[ot],O=Z+K,++F}else C[q++]=t[Z],++I[t[Z]]}}for(Z=Math.max(Z,O);Z<c;++Z)C[q++]=t[Z],++I[t[Z]];y=H(t,d,g,C,I,U,E,q,G,Z-G,y),g||(l.r=7&y|d[y/8|0]<<3,y-=7,l.h=k,l.p=z,l.i=Z,l.w=O)}else{for(Z=l.w||0;Z<c+g;Z+=65535){var st=Z+65535;st>=c&&(d[y/8|0]=g,st=c),y=L(d,y+1,t.subarray(Z,st))}l.i=c}return D(v,0,u+T(y)+h)},B=function(){for(var t=new Int32Array(256),n=0;n<256;++n){for(var r=n,e=9;--e;)r=(1&r&&-306674912)^r>>>1;t[n]=r}return t}(),Y=function(){var t=-1;return{p:function(n){for(var r=t,e=0;e<n.length;++e)r=B[255&r^n[e]]^r>>>8;t=r},d:function(){return~t}}},J=function(){var t=1,n=0;return{p:function(r){for(var e=t,i=n,o=0|r.length,s=0;s!=o;){for(var a=Math.min(s+2655,o);s<a;++s)i+=e+=r[s];e=(65535&e)+15*(e>>16),i=(65535&i)+15*(i>>16)}t=e,n=i},d:function(){return(255&(t%=65521))<<24|(65280&t)<<8|(255&(n%=65521))<<8|n>>8}}},K=function(t,r,e,i,o){if(!o&&(o={l:1},r.dictionary)){var s=r.dictionary.subarray(-32768),a=new n(s.length+t.length);a.set(s),a.set(t,s.length),t=a,o.w=s.length}return P(t,null==r.level?6:r.level,null==r.mem?o.l?Math.ceil(1.5*Math.max(8,Math.min(13,Math.log(t.length)))):20:12+r.mem,e,i,o)},Q=function(t,n){var r={};for(var e in t)r[e]=t[e];for(var e in n)r[e]=n[e];return r},R=function(t,n,r){for(var e=t(),i=""+t,o=i.slice(i.indexOf("[")+1,i.lastIndexOf("]")).replace(/\s+/g,"").split(","),s=0;s<e.length;++s){var a=e[s],u=o[s];if("function"==typeof a){n+=";"+u+"=";var h=""+a;if(a.prototype)if(-1!=h.indexOf("[native code]")){var f=h.indexOf(" ",8)+1;n+=h.slice(f,h.indexOf("(",f))}else for(var l in n+=h,a.prototype)n+=";"+u+".prototype."+l+"="+a.prototype[l];else n+=h}else r[u]=a}return n},V=[],W=function(t){var n=[];for(var r in t)t[r].buffer&&n.push((t[r]=new t[r].constructor(t[r])).buffer);return n},X=function(n,r,e,i){if(!V[e]){for(var o="",s={},a=n.length-1,u=0;u<a;++u)o=R(n[u],o,s);V[e]={c:R(n[a],o,s),e:s}}var h=Q({},V[e].e);return(0,t.default)(V[e].c+";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage="+r+"}",e,h,W(h),i)},$=function(){return[n,r,e,i,o,s,h,c,x,k,v,C,y,M,S,A,T,D,I,U,Tt,it,ot]},_=function(){return[n,r,e,i,o,s,f,p,w,m,z,b,v,j,N,y,F,E,Z,q,O,G,L,H,T,D,P,K,kt,it]},tt=function(){return[pt,gt,ct,Y,B]},nt=function(){return[vt,dt]},rt=function(){return[yt,ct,J]},et=function(){return[mt]},it=function(t){return postMessage(t,[t.buffer])},ot=function(t){return t&&{out:t.size&&new n(t.size),dictionary:t.dictionary}},st=function(t,n,r,e,i,o){var s=X(r,e,i,(function(t,n){s.terminate(),o(t,n)}));return s.postMessage([t,n],n.consume?[t.buffer]:[]),function(){s.terminate()}},at=function(t){return t.ondata=function(t,n){return postMessage([t,n],[t.buffer])},function(n){n.data.length?(t.push(n.data[0],n.data[1]),postMessage([n.data[0].length])):t.flush()}},ut=function(t,n,r,e,i,o,s){var a,u=X(t,e,i,(function(t,r){t?(u.terminate(),n.ondata.call(n,t)):Array.isArray(r)?1==r.length?(n.queuedSize-=r[0],n.ondrain&&n.ondrain(r[0])):(r[1]&&u.terminate(),n.ondata.call(n,t,r[0],r[1])):s(r)}));u.postMessage(r),n.queuedSize=0,n.push=function(t,r){n.ondata||I(5),a&&n.ondata(I(4,0,1),null,!!r),n.queuedSize+=t.length,u.postMessage([t,a=r],[t.buffer])},n.terminate=function(){u.terminate()},o&&(n.flush=function(){u.postMessage([])})},ht=function(t,n){return t[n]|t[n+1]<<8},ft=function(t,n){return(t[n]|t[n+1]<<8|t[n+2]<<16|t[n+3]<<24)>>>0},lt=function(t,n){return ft(t,n)+4294967296*ft(t,n+4)},ct=function(t,n,r){for(;r;++n)t[n]=r,r>>>=8},pt=function(t,n){var r=n.filename;if(t[0]=31,t[1]=139,t[2]=8,t[8]=n.level<2?4:9==n.level?2:0,t[9]=3,0!=n.mtime&&ct(t,4,Math.floor(new Date(n.mtime||Date.now())/1e3)),r){t[3]=8;for(var e=0;e<=r.length;++e)t[e+10]=r.charCodeAt(e)}},vt=function(t){31==t[0]&&139==t[1]&&8==t[2]||I(6,"invalid gzip data");var n=t[3],r=10;4&n&&(r+=2+(t[10]|t[11]<<8));for(var e=(n>>3&1)+(n>>4&1);e>0;e-=!t[r++]);return r+(2&n)},dt=function(t){var n=t.length;return(t[n-4]|t[n-3]<<8|t[n-2]<<16|t[n-1]<<24)>>>0},gt=function(t){return 10+(t.filename?t.filename.length+1:0)},yt=function(t,n){var r=n.level,e=0==r?0:r<6?1:9==r?3:2;if(t[0]=120,t[1]=e<<6|(n.dictionary&&32),t[1]|=31-(t[0]<<8|t[1])%31,n.dictionary){var i=J();i.p(n.dictionary),ct(t,2,i.d())}},mt=function(t,n){return(8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31)&&I(6,"invalid zlib data"),(t[1]>>5&1)==+!n&&I(6,"invalid zlib data: "+(32&t[1]?"need":"unexpected")+" dictionary"),2+(t[1]>>3&4)};function bt(t,n){return"function"==typeof t&&(n=t,t={}),this.ondata=n,t}var wt=function(){function t(t,r){if("function"==typeof t&&(r=t,t={}),this.ondata=r,this.o=t||{},this.s={l:0,i:32768,w:32768,z:32768},this.b=new n(98304),this.o.dictionary){var e=this.o.dictionary.subarray(-32768);this.b.set(e,32768-e.length),this.s.i=32768-e.length}}return t.prototype.p=function(t,n){this.ondata(K(t,this.o,0,0,this.s),n)},t.prototype.push=function(t,r){this.ondata||I(5),this.s.l&&I(4);var e=t.length+this.s.z;if(e>this.b.length){if(e>2*this.b.length-32768){var i=new n(-32768&e);i.set(this.b.subarray(0,this.s.z)),this.b=i}var o=this.b.length-this.s.z;this.b.set(t.subarray(0,o),this.s.z),this.s.z=this.b.length,this.p(this.b,!1),this.b.set(this.b.subarray(-32768)),this.b.set(t.subarray(o),32768),this.s.z=t.length-o+32768,this.s.i=32766,this.s.w=32768}else this.b.set(t,this.s.z),this.s.z+=t.length;this.s.l=1&r,(this.s.z>this.s.w+8191||r)&&(this.p(this.b,r||!1),this.s.w=this.s.i,this.s.i-=2)},t.prototype.flush=function(){this.ondata||I(5),this.s.l&&I(4),this.p(this.b,!1),this.s.w=this.s.i,this.s.i-=2},t}();_e.Deflate=wt;var xt=function(){return function(t,n){ut([_,function(){return[at,wt]}],this,bt.call(this,t,n),(function(t){var n=new wt(t.data);onmessage=at(n)}),6,1)}}();function zt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[_],(function(t){return it(kt(t.data[0],t.data[1]))}),0,r)}function kt(t,n){return K(t,n||{},0,0)}_e.AsyncDeflate=xt,_e.deflate=zt,_e.deflateSync=kt;var Mt=function(){function t(t,r){"function"==typeof t&&(r=t,t={}),this.ondata=r;var e=t&&t.dictionary&&t.dictionary.subarray(-32768);this.s={i:0,b:e?e.length:0},this.o=new n(32768),this.p=new n(0),e&&this.o.set(e)}return t.prototype.e=function(t){if(this.ondata||I(5),this.d&&I(4),this.p.length){if(t.length){var r=new n(this.p.length+t.length);r.set(this.p),r.set(t,this.p.length),this.p=r}}else this.p=t},t.prototype.c=function(t){this.s.i=+(this.d=t||!1);var n=this.s.b,r=U(this.p,this.s,this.o);this.ondata(D(r,n,this.s.b),this.d),this.o=D(r,this.s.b-32768),this.s.b=this.o.length,this.p=D(this.p,this.s.p/8|0),this.s.p&=7},t.prototype.push=function(t,n){this.e(t),this.c(n)},t}();_e.Inflate=Mt;var St=function(){return function(t,n){ut([$,function(){return[at,Mt]}],this,bt.call(this,t,n),(function(t){var n=new Mt(t.data);onmessage=at(n)}),7,0)}}();function At(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[$],(function(t){return it(Tt(t.data[0],ot(t.data[1])))}),1,r)}function Tt(t,n){return U(t,{i:2},n&&n.out,n&&n.dictionary)}_e.AsyncInflate=St,_e.inflate=At,_e.inflateSync=Tt;var Dt=function(){function t(t,n){this.c=Y(),this.l=0,this.v=1,wt.call(this,t,n)}return t.prototype.push=function(t,n){this.c.p(t),this.l+=t.length,wt.prototype.push.call(this,t,n)},t.prototype.p=function(t,n){var r=K(t,this.o,this.v&&gt(this.o),n&&8,this.s);this.v&&(pt(r,this.o),this.v=0),n&&(ct(r,r.length-8,this.c.d()),ct(r,r.length-4,this.l)),this.ondata(r,n)},t.prototype.flush=function(){wt.prototype.flush.call(this)},t}();_e.Gzip=Dt,_e.Compress=Dt;var Ct=function(){return function(t,n){ut([_,tt,function(){return[at,wt,Dt]}],this,bt.call(this,t,n),(function(t){var n=new Dt(t.data);onmessage=at(n)}),8,1)}}();function It(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[_,tt,function(){return[Ut]}],(function(t){return it(Ut(t.data[0],t.data[1]))}),2,r)}function Ut(t,n){n||(n={});var r=Y(),e=t.length;r.p(t);var i=K(t,n,gt(n),8),o=i.length;return pt(i,n),ct(i,o-8,r.d()),ct(i,o-4,e),i}_e.AsyncGzip=Ct,_e.AsyncCompress=Ct,_e.gzip=It,_e.compress=It,_e.gzipSync=Ut,_e.compressSync=Ut;var Ft=function(){function t(t,n){this.v=1,this.r=0,Mt.call(this,t,n)}return t.prototype.push=function(t,r){if(Mt.prototype.e.call(this,t),this.r+=t.length,this.v){var e=this.p.subarray(this.v-1),i=e.length>3?vt(e):4;if(i>e.length){if(!r)return}else this.v>1&&this.onmember&&this.onmember(this.r-e.length);this.p=e.subarray(i),this.v=0}Mt.prototype.c.call(this,r),!this.s.f||this.s.l||r||(this.v=T(this.s.p)+9,this.s={i:0},this.o=new n(0),this.push(new n(0),r))},t}();_e.Gunzip=Ft;var Et=function(){return function(t,n){var r=this;ut([$,nt,function(){return[at,Mt,Ft]}],this,bt.call(this,t,n),(function(t){var n=new Ft(t.data);n.onmember=function(t){return postMessage(t)},onmessage=at(n)}),9,0,(function(t){return r.onmember&&r.onmember(t)}))}}();function Zt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[$,nt,function(){return[qt]}],(function(t){return it(qt(t.data[0],t.data[1]))}),3,r)}function qt(t,r){var e=vt(t);return e+8>t.length&&I(6,"invalid gzip data"),U(t.subarray(e,-8),{i:2},r&&r.out||new n(dt(t)),r&&r.dictionary)}_e.AsyncGunzip=Et,_e.gunzip=Zt,_e.gunzipSync=qt;var Ot=function(){function t(t,n){this.c=J(),this.v=1,wt.call(this,t,n)}return t.prototype.push=function(t,n){this.c.p(t),wt.prototype.push.call(this,t,n)},t.prototype.p=function(t,n){var r=K(t,this.o,this.v&&(this.o.dictionary?6:2),n&&4,this.s);this.v&&(yt(r,this.o),this.v=0),n&&ct(r,r.length-4,this.c.d()),this.ondata(r,n)},t.prototype.flush=function(){wt.prototype.flush.call(this)},t}();_e.Zlib=Ot;var Gt=function(){return function(t,n){ut([_,rt,function(){return[at,wt,Ot]}],this,bt.call(this,t,n),(function(t){var n=new Ot(t.data);onmessage=at(n)}),10,1)}}();function Lt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[_,rt,function(){return[Ht]}],(function(t){return it(Ht(t.data[0],t.data[1]))}),4,r)}function Ht(t,n){n||(n={});var r=J();r.p(t);var e=K(t,n,n.dictionary?6:2,4);return yt(e,n),ct(e,e.length-4,r.d()),e}_e.AsyncZlib=Gt,_e.zlib=Lt,_e.zlibSync=Ht;var jt=function(){function t(t,n){Mt.call(this,t,n),this.v=t&&t.dictionary?2:1}return t.prototype.push=function(t,n){if(Mt.prototype.e.call(this,t),this.v){if(this.p.length<6&&!n)return;this.p=this.p.subarray(mt(this.p,this.v-1)),this.v=0}n&&(this.p.length<4&&I(6,"invalid zlib data"),this.p=this.p.subarray(0,-4)),Mt.prototype.c.call(this,n)},t}();_e.Unzlib=jt;var Nt=function(){return function(t,n){ut([$,et,function(){return[at,Mt,jt]}],this,bt.call(this,t,n),(function(t){var n=new jt(t.data);onmessage=at(n)}),11,0)}}();function Pt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[$,et,function(){return[Bt]}],(function(t){return it(Bt(t.data[0],ot(t.data[1])))}),5,r)}function Bt(t,n){return U(t.subarray(mt(t,n&&n.dictionary),-4),{i:2},n&&n.out,n&&n.dictionary)}_e.AsyncUnzlib=Nt,_e.unzlib=Pt,_e.unzlibSync=Bt;var Yt=function(){function t(t,n){this.o=bt.call(this,t,n)||{},this.G=Ft,this.I=Mt,this.Z=jt}return t.prototype.i=function(){var t=this;this.s.ondata=function(n,r){t.ondata(n,r)}},t.prototype.push=function(t,r){if(this.ondata||I(5),this.s)this.s.push(t,r);else{if(this.p&&this.p.length){var e=new n(this.p.length+t.length);e.set(this.p),e.set(t,this.p.length)}else this.p=t;this.p.length>2&&(this.s=31==this.p[0]&&139==this.p[1]&&8==this.p[2]?new this.G(this.o):8!=(15&this.p[0])||this.p[0]>>4>7||(this.p[0]<<8|this.p[1])%31?new this.I(this.o):new this.Z(this.o),this.i(),this.s.push(this.p,r),this.p=null)}},t}();_e.Decompress=Yt;var Jt=function(){function t(t,n){Yt.call(this,t,n),this.queuedSize=0,this.G=Et,this.I=St,this.Z=Nt}return t.prototype.i=function(){var t=this;this.s.ondata=function(n,r,e){t.ondata(n,r,e)},this.s.ondrain=function(n){t.queuedSize-=n,t.ondrain&&t.ondrain(n)}},t.prototype.push=function(t,n){this.queuedSize+=t.length,Yt.prototype.push.call(this,t,n)},t}();function Kt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),31==t[0]&&139==t[1]&&8==t[2]?Zt(t,n,r):8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31?At(t,n,r):Pt(t,n,r)}function Qt(t,n){return 31==t[0]&&139==t[1]&&8==t[2]?qt(t,n):8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31?Tt(t,n):Bt(t,n)}_e.AsyncDecompress=Jt,_e.decompress=Kt,_e.decompressSync=Qt;var Rt=function(t,r,e,i){for(var o in t){var s=t[o],a=r+o,u=i;Array.isArray(s)&&(u=Q(i,s[1]),s=s[0]),s instanceof n?e[a]=[s,u]:(e[a+="/"]=[new n(0),u],Rt(s,a,e,i))}},Vt="undefined"!=typeof TextEncoder&&new TextEncoder,Wt="undefined"!=typeof TextDecoder&&new TextDecoder,Xt=0;try{Wt.decode(N,{stream:!0}),Xt=1}catch(t){}var $t=function(t){for(var n="",r=0;;){var e=t[r++],i=(e>127)+(e>223)+(e>239);if(r+i>t.length)return{s:n,r:D(t,r-1)};i?3==i?(e=((15&e)<<18|(63&t[r++])<<12|(63&t[r++])<<6|63&t[r++])-65536,n+=String.fromCharCode(55296|e>>10,56320|1023&e)):n+=String.fromCharCode(1&i?(31&e)<<6|63&t[r++]:(15&e)<<12|(63&t[r++])<<6|63&t[r++]):n+=String.fromCharCode(e)}},_t=function(){function t(t){this.ondata=t,Xt?this.t=new TextDecoder:this.p=N}return t.prototype.push=function(t,r){if(this.ondata||I(5),r=!!r,this.t)return this.ondata(this.t.decode(t,{stream:!0}),r),void(r&&(this.t.decode().length&&I(8),this.t=null));this.p||I(4);var e=new n(this.p.length+t.length);e.set(this.p),e.set(t,this.p.length);var i=$t(e),o=i.s,s=i.r;r?(s.length&&I(8),this.p=null):this.p=s,this.ondata(o,r)},t}();_e.DecodeUTF8=_t;var tn=function(){function t(t){this.ondata=t}return t.prototype.push=function(t,n){this.ondata||I(5),this.d&&I(4),this.ondata(nn(t),this.d=n||!1)},t}();function nn(t,r){if(r){for(var e=new n(t.length),i=0;i<t.length;++i)e[i]=t.charCodeAt(i);return e}if(Vt)return Vt.encode(t);var o=t.length,s=new n(t.length+(t.length>>1)),a=0,u=function(t){s[a++]=t};for(i=0;i<o;++i){if(a+5>s.length){var h=new n(a+8+(o-i<<1));h.set(s),s=h}var f=t.charCodeAt(i);f<128||r?u(f):f<2048?(u(192|f>>6),u(128|63&f)):f>55295&&f<57344?(u(240|(f=65536+(1047552&f)|1023&t.charCodeAt(++i))>>18),u(128|f>>12&63),u(128|f>>6&63),u(128|63&f)):(u(224|f>>12),u(128|f>>6&63),u(128|63&f))}return D(s,0,a)}function rn(t,n){if(n){for(var r="",e=0;e<t.length;e+=16384)r+=String.fromCharCode.apply(null,t.subarray(e,e+16384));return r}if(Wt)return Wt.decode(t);var i=$t(t),o=i.s;return(r=i.r).length&&I(8),o}_e.EncodeUTF8=tn,_e.strToU8=nn,_e.strFromU8=rn;var en=function(t){return 1==t?3:t<6?2:9==t?1:0},on=function(t,n){return n+30+ht(t,n+26)+ht(t,n+28)},sn=function(t,n,r){var e=ht(t,n+28),i=rn(t.subarray(n+46,n+46+e),!(2048&ht(t,n+8))),o=n+46+e,s=ft(t,n+20),a=r&&4294967295==s?an(t,o):[s,ft(t,n+24),ft(t,n+42)],u=a[0],h=a[1],f=a[2];return[ht(t,n+10),u,h,i,o+ht(t,n+30)+ht(t,n+32),f]},an=function(t,n){for(;1!=ht(t,n);n+=4+ht(t,n+2));return[lt(t,n+12),lt(t,n+4),lt(t,n+20)]},un=function(t){var n=0;if(t)for(var r in t){var e=t[r].length;e>65535&&I(9),n+=e+4}return n},hn=function(t,n,r,e,i,o,s,a){var u=e.length,h=r.extra,f=a&&a.length,l=un(h);ct(t,n,null!=s?33639248:67324752),n+=4,null!=s&&(t[n++]=20,t[n++]=r.os),t[n]=20,n+=2,t[n++]=r.flag<<1|(o<0&&8),t[n++]=i&&8,t[n++]=255&r.compression,t[n++]=r.compression>>8;var c=new Date(null==r.mtime?Date.now():r.mtime),p=c.getFullYear()-1980;if((p<0||p>119)&&I(10),ct(t,n,p<<25|c.getMonth()+1<<21|c.getDate()<<16|c.getHours()<<11|c.getMinutes()<<5|c.getSeconds()>>1),n+=4,-1!=o&&(ct(t,n,r.crc),ct(t,n+4,o<0?-o-2:o),ct(t,n+8,r.size)),ct(t,n+12,u),ct(t,n+14,l),n+=16,null!=s&&(ct(t,n,f),ct(t,n+6,r.attrs),ct(t,n+10,s),n+=14),t.set(e,n),n+=u,l)for(var v in h){var d=h[v],g=d.length;ct(t,n,+v),ct(t,n+2,g),t.set(d,n+4),n+=4+g}return f&&(t.set(a,n),n+=f),n},fn=function(t,n,r,e,i){ct(t,n,101010256),ct(t,n+8,r),ct(t,n+10,r),ct(t,n+12,e),ct(t,n+16,i)},ln=function(){function t(t){this.filename=t,this.c=Y(),this.size=0,this.compression=0}return t.prototype.process=function(t,n){this.ondata(null,t,n)},t.prototype.push=function(t,n){this.ondata||I(5),this.c.p(t),this.size+=t.length,n&&(this.crc=this.c.d()),this.process(t,n||!1)},t}();_e.ZipPassThrough=ln;var cn=function(){function t(t,n){var r=this;n||(n={}),ln.call(this,t),this.d=new wt(n,(function(t,n){r.ondata(null,t,n)})),this.compression=8,this.flag=en(n.level)}return t.prototype.process=function(t,n){try{this.d.push(t,n)}catch(t){this.ondata(t,null,n)}},t.prototype.push=function(t,n){ln.prototype.push.call(this,t,n)},t}();_e.ZipDeflate=cn;var pn=function(){function t(t,n){var r=this;n||(n={}),ln.call(this,t),this.d=new xt(n,(function(t,n,e){r.ondata(t,n,e)})),this.compression=8,this.flag=en(n.level),this.terminate=this.d.terminate}return t.prototype.process=function(t,n){this.d.push(t,n)},t.prototype.push=function(t,n){ln.prototype.push.call(this,t,n)},t}();_e.AsyncZipDeflate=pn;var vn=function(){function t(t){this.ondata=t,this.u=[],this.d=1}return t.prototype.add=function(t){var r=this;if(this.ondata||I(5),2&this.d)this.ondata(I(4+8*(1&this.d),0,1),null,!1);else{var e=nn(t.filename),i=e.length,o=t.comment,s=o&&nn(o),a=i!=t.filename.length||s&&o.length!=s.length,u=i+un(t.extra)+30;i>65535&&this.ondata(I(11,0,1),null,!1);var h=new n(u);hn(h,0,t,e,a,-1);var f=[h],l=function(){for(var t=0,n=f;t<n.length;t++)r.ondata(null,n[t],!1);f=[]},c=this.d;this.d=0;var p=this.u.length,v=Q(t,{f:e,u:a,o:s,t:function(){t.terminate&&t.terminate()},r:function(){if(l(),c){var t=r.u[p+1];t?t.r():r.d=1}c=1}}),d=0;t.ondata=function(e,i,o){if(e)r.ondata(e,i,o),r.terminate();else if(d+=i.length,f.push(i),o){var s=new n(16);ct(s,0,134695760),ct(s,4,t.crc),ct(s,8,d),ct(s,12,t.size),f.push(s),v.c=d,v.b=u+d+16,v.crc=t.crc,v.size=t.size,c&&v.r(),c=1}else c&&l()},this.u.push(v)}},t.prototype.end=function(){var t=this;2&this.d?this.ondata(I(4+8*(1&this.d),0,1),null,!0):(this.d?this.e():this.u.push({r:function(){1&t.d&&(t.u.splice(-1,1),t.e())},t:function(){}}),this.d=3)},t.prototype.e=function(){for(var t=0,r=0,e=0,i=0,o=this.u;i<o.length;i++)e+=46+(h=o[i]).f.length+un(h.extra)+(h.o?h.o.length:0);for(var s=new n(e+22),a=0,u=this.u;a<u.length;a++){var h;hn(s,t,h=u[a],h.f,h.u,-h.c-2,r,h.o),t+=46+h.f.length+un(h.extra)+(h.o?h.o.length:0),r+=h.b}fn(s,t,this.u.length,e,r),this.ondata(null,s,!0),this.d=2},t.prototype.terminate=function(){for(var t=0,n=this.u;t<n.length;t++)n[t].t();this.d=2},t}();function dn(t,r,e){e||(e=r,r={}),"function"!=typeof e&&I(7);var i={};Rt(t,"",i,r);var o=Object.keys(i),s=o.length,a=0,u=0,h=s,f=Array(s),l=[],c=function(){for(var t=0;t<l.length;++t)l[t]()},p=function(t,n){xn((function(){e(t,n)}))};xn((function(){p=e}));var v=function(){var t=new n(u+22),r=a,e=u-a;u=0;for(var i=0;i<h;++i){var o=f[i];try{var s=o.c.length;hn(t,u,o,o.f,o.u,s);var l=30+o.f.length+un(o.extra),c=u+l;t.set(o.c,c),hn(t,a,o,o.f,o.u,s,u,o.m),a+=16+l+(o.m?o.m.length:0),u=c+s}catch(t){return p(t,null)}}fn(t,a,f.length,e,r),p(null,t)};s||v();for(var d=function(t){var n=o[t],r=i[n],e=r[0],h=r[1],d=Y(),g=e.length;d.p(e);var y=nn(n),m=y.length,b=h.comment,w=b&&nn(b),x=w&&w.length,z=un(h.extra),k=0==h.level?0:8,M=function(r,e){if(r)c(),p(r,null);else{var i=e.length;f[t]=Q(h,{size:g,crc:d.d(),c:e,f:y,m:w,u:m!=n.length||w&&b.length!=x,compression:k}),a+=30+m+z+i,u+=76+2*(m+z)+(x||0)+i,--s||v()}};if(m>65535&&M(I(11,0,1),null),k)if(g<16e4)try{M(null,kt(e,h))}catch(t){M(t,null)}else l.push(zt(e,h,M));else M(null,e)},g=0;g<h;++g)d(g);return c}function gn(t,r){r||(r={});var e={},i=[];Rt(t,"",e,r);var o=0,s=0;for(var a in e){var u=e[a],h=u[0],f=u[1],l=0==f.level?0:8,c=(M=nn(a)).length,p=f.comment,v=p&&nn(p),d=v&&v.length,g=un(f.extra);c>65535&&I(11);var y=l?kt(h,f):h,m=y.length,b=Y();b.p(h),i.push(Q(f,{size:h.length,crc:b.d(),c:y,f:M,m:v,u:c!=a.length||v&&p.length!=d,o:o,compression:l})),o+=30+c+g+m,s+=76+2*(c+g)+(d||0)+m}for(var w=new n(s+22),x=o,z=s-o,k=0;k<i.length;++k){var M;hn(w,(M=i[k]).o,M,M.f,M.u,M.c.length);var S=30+M.f.length+un(M.extra);w.set(M.c,M.o+S),hn(w,o,M,M.f,M.u,M.c.length,M.o,M.m),o+=16+S+(M.m?M.m.length:0)}return fn(w,o,i.length,z,x),w}_e.Zip=vn,_e.zip=dn,_e.zipSync=gn;var yn=function(){function t(){}return t.prototype.push=function(t,n){this.ondata(null,t,n)},t.compression=0,t}();_e.UnzipPassThrough=yn;var mn=function(){function t(){var t=this;this.i=new Mt((function(n,r){t.ondata(null,n,r)}))}return t.prototype.push=function(t,n){try{this.i.push(t,n)}catch(t){this.ondata(t,null,n)}},t.compression=8,t}();_e.UnzipInflate=mn;var bn=function(){function t(t,n){var r=this;n<32e4?this.i=new Mt((function(t,n){r.ondata(null,t,n)})):(this.i=new St((function(t,n,e){r.ondata(t,n,e)})),this.terminate=this.i.terminate)}return t.prototype.push=function(t,n){this.i.terminate&&(t=D(t,0)),this.i.push(t,n)},t.compression=8,t}();_e.AsyncUnzipInflate=bn;var wn=function(){function t(t){this.onfile=t,this.k=[],this.o={0:yn},this.p=N}return t.prototype.push=function(t,r){var e=this;if(this.onfile||I(5),this.p||I(4),this.c>0){var i=Math.min(this.c,t.length),o=t.subarray(0,i);if(this.c-=i,this.d?this.d.push(o,!this.c):this.k[0].push(o),(t=t.subarray(i)).length)return this.push(t,r)}else{var s=0,a=0,u=void 0,h=void 0;this.p.length?t.length?((h=new n(this.p.length+t.length)).set(this.p),h.set(t,this.p.length)):h=this.p:h=t;for(var f=h.length,l=this.c,c=l&&this.d,p=function(){var t,n=ft(h,a);if(67324752==n){s=1,u=a,v.d=null,v.c=0;var r=ht(h,a+6),i=ht(h,a+8),o=2048&r,c=8&r,p=ht(h,a+26),d=ht(h,a+28);if(f>a+30+p+d){var g=[];v.k.unshift(g),s=2;var y,m=ft(h,a+18),b=ft(h,a+22),w=rn(h.subarray(a+30,a+=30+p),!o);4294967295==m?(t=c?[-2]:an(h,a),m=t[0],b=t[1]):c&&(m=-1),a+=d,v.c=m;var x={name:w,compression:i,start:function(){if(x.ondata||I(5),m){var t=e.o[i];t||x.ondata(I(14,"unknown compression type "+i,1),null,!1),(y=m<0?new t(w):new t(w,m,b)).ondata=function(t,n,r){x.ondata(t,n,r)};for(var n=0,r=g;n<r.length;n++)y.push(r[n],!1);e.k[0]==g&&e.c?e.d=y:y.push(N,!0)}else x.ondata(null,N,!0)},terminate:function(){y&&y.terminate&&y.terminate()}};m>=0&&(x.size=m,x.originalSize=b),v.onfile(x)}return"break"}if(l){if(134695760==n)return u=a+=12+(-2==l&&8),s=3,v.c=0,"break";if(33639248==n)return u=a-=4,s=3,v.c=0,"break"}},v=this;a<f-4&&"break"!==p();++a);if(this.p=N,l<0){var d=h.subarray(0,s?u-12-(-2==l&&8)-(134695760==ft(h,u-16)&&4):a);c?c.push(d,!!s):this.k[+(2==s)].push(d)}if(2&s)return this.push(h.subarray(a),r);this.p=h.subarray(a)}r&&(this.c&&I(13),this.p=null)},t.prototype.register=function(t){this.o[t.compression]=t},t}();_e.Unzip=wn;var xn="function"==typeof queueMicrotask?queueMicrotask:"function"==typeof setTimeout?setTimeout:function(t){t()};function zn(t,r,e){e||(e=r,r={}),"function"!=typeof e&&I(7);var i=[],o=function(){for(var t=0;t<i.length;++t)i[t]()},s={},a=function(t,n){xn((function(){e(t,n)}))};xn((function(){a=e}));for(var u=t.length-22;101010256!=ft(t,u);--u)if(!u||t.length-u>65558)return a(I(13,0,1),null),o;var h=ht(t,u+8);if(h){var f=h,l=ft(t,u+16),c=4294967295==l||65535==f;if(c){var p=ft(t,u-12);(c=101075792==ft(t,p))&&(f=h=ft(t,p+32),l=ft(t,p+48))}for(var v=r&&r.filter,d=function(r){var e=sn(t,l,c),u=e[0],f=e[1],p=e[2],d=e[3],g=e[4],y=on(t,e[5]);l=g;var m=function(t,n){t?(o(),a(t,null)):(n&&(s[d]=n),--h||a(null,s))};if(!v||v({name:d,size:f,originalSize:p,compression:u}))if(u)if(8==u){var b=t.subarray(y,y+f);if(p<524288||f>.8*p)try{m(null,Tt(b,{out:new n(p)}))}catch(t){m(t,null)}else i.push(At(b,{size:p},m))}else m(I(14,"unknown compression type "+u,1),null);else m(null,D(t,y,y+f));else m(null,null)},g=0;g<f;++g)d()}else a(null,{});return o}function kn(t,r){for(var e={},i=t.length-22;101010256!=ft(t,i);--i)(!i||t.length-i>65558)&&I(13);var o=ht(t,i+8);if(!o)return{};var s=ft(t,i+16),a=4294967295==s||65535==o;if(a){var u=ft(t,i-12);(a=101075792==ft(t,u))&&(o=ft(t,u+32),s=ft(t,u+48))}for(var h=r&&r.filter,f=0;f<o;++f){var l=sn(t,s,a),c=l[0],p=l[1],v=l[2],d=l[3],g=l[4],y=on(t,l[5]);s=g,h&&!h({name:d,size:p,originalSize:v,compression:c})||(c?8==c?e[d]=Tt(t.subarray(y,y+p),{out:new n(v)}):I(14,"unknown compression type "+c):e[d]=D(t,y,y+p))}return e}_e.unzip=zn,_e.unzipSync=kn;return _e});
;
// 本地暗号素材包。ZIP 目录和大小校验先于解压，所有写入由 repository 管理。
const memoryZip = (() => {
    const MiB = 1024 * 1024;
    const limits = { archive: 50 * MiB, total: 100 * MiB, file: 10 * MiB, files: 300, images: 200 };
    const imageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const encoder = new TextEncoder();
    const format = 'uwu-memory-pack';
    const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
        for (let bit = 0; bit < 8; bit++) index = (index >>> 1) ^ ((index & 1) ? 0xedb88320 : 0);
        return index;
    });
    const requireZip = (condition, message = 'ZIP 已损坏或格式不受支持') => {
        if (!condition) throw new Error(message);
    };
    const text = value => typeof value === 'string';
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));

    function validPath(name) {
        requireZip(text(name) && name.length > 0 && !/[\\\\\x00-\x1f:]/.test(name)
            && name.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..'),
        'ZIP 包含无效路径');
        return name;
    }

    function readDirectory(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const u16 = offset => view.getUint16(offset, true);
        const u32 = offset => view.getUint32(offset, true);
        let end = bytes.length - 22;
        const earliest = Math.max(0, end - 65535);
        for (; end >= earliest; end--) {
            if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
        }
        requireZip(end >= earliest);
        requireZip(!u16(end + 4) && !u16(end + 6) && u16(end + 8) === u16(end + 10));
        const count = u16(end + 10);
        const start = u32(end + 16);
        requireZip(count <= limits.files, 'ZIP 文件数量超过上限');
        requireZip(start + u32(end + 12) === end);

        const files = new Map();
        const ranges = [];
        let total = 0;
        let cursor = start;
        for (let index = 0; index < count; index++) {
            requireZip(cursor + 46 <= end && u32(cursor) === 0x02014b50);
            const flags = u16(cursor + 8);
            const method = u16(cursor + 10);
            const compressedSize = u32(cursor + 20);
            const size = u32(cursor + 24);
            const nameLength = u16(cursor + 28);
            const local = u32(cursor + 42);
            const next = cursor + 46 + nameLength + u16(cursor + 30) + u16(cursor + 32);
            requireZip(next <= end && !u16(cursor + 34) && !(flags & ~0x080e) && (method === 0 || method === 8));
            const name = validPath(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));
            requireZip(!files.has(name), 'ZIP 包含重名文件');
            total += size;
            requireZip(size <= limits.file && total <= limits.total, 'ZIP 解压大小超过上限');
            requireZip(local + 30 <= start && u32(local) === 0x04034b50
                && u16(local + 6) === flags && u16(local + 8) === method);
            const payload = local + 30 + u16(local + 26) + u16(local + 28);
            requireZip(payload + compressedSize <= start && u16(local + 26) === nameLength
                && decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) === name);
            const crc = u32(cursor + 16);
            if (!(flags & 8)) {
                requireZip(u32(local + 14) === crc && u32(local + 18) === compressedSize && u32(local + 22) === size);
            }
            ranges.push([local, payload + compressedSize]);
            files.set(name, { method, size, crc, compressed: bytes.subarray(payload, payload + compressedSize) });
            cursor = next;
        }
        requireZip(cursor === end);
        ranges.sort((left, right) => left[0] - right[0]);
        requireZip(ranges.every(([start], index) => index === 0 || start >= ranges[index - 1][1]));
        return files;
    }

    async function unpack(file, signal) {
        let crc = -1;
        let length = 0;
        const result = new Uint8Array(file.size);
        function append(chunk) {
            length += chunk.length;
            requireZip(length <= file.size, 'ZIP 实际解压大小超出声明');
            result.set(chunk, length - chunk.length);
            for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
        }
        if (file.method === 0) {
            append(file.compressed);
        } else {
            const inflater = new fflate.Inflate(append);
            for (let offset = 0; offset < file.compressed.length; offset += 8192) {
                signal?.throwIfAborted();
                if (offset % (256 * 1024) === 0) await pause();
                const end = Math.min(offset + 8192, file.compressed.length);
                inflater.push(file.compressed.subarray(offset, end), end === file.compressed.length);
            }
            requireZip(file.compressed.length > 0);
        }
        requireZip(length === file.size && (crc ^ -1) >>> 0 === file.crc, 'ZIP 文件的 CRC 或大小校验失败');
        return result;
    }

    async function sha256(bytes) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function inspectImage(name, bytes, mimeType) {
        const blob = new Blob([bytes], { type: mimeType });
        const signature = String.fromCharCode(...bytes.subarray(0, 12));
        requireZip(memoryRepository.hasImageSignature(signature, mimeType), `图片格式无效：${name}`);
        const image = await createImageBitmap(blob).catch(() => { throw new Error(`图片无法读取：${name}`); });
        image.close();
        return { blob, mimeType, fileName: name.split('/').at(-1), sha256: await sha256(bytes) };
    }

    function parseEntries(manifest, prefix, images) {
        requireZip(manifest?.format === format && manifest.schemaVersion === 1, '不支持的暗号包格式或版本');
        requireZip(text(manifest.packId) && manifest.packId.trim() && text(manifest.name) && manifest.name.trim()
            && Array.isArray(manifest.entries) && manifest.entries.length <= limits.files, '暗号包信息无效');
        const ids = new Set();
        return manifest.entries.map(item => {
            requireZip(item?.type === 'code' && text(item.id) && item.id.trim() && !ids.has(item.id), '暗号 ID 重复或无效');
            ids.add(item.id);
            const assets = new Map();
            const warnings = [];
            const attach = path => {
                const name = prefix + validPath(path);
                const asset = images.get(name);
                if (asset) assets.set(name, asset);
                else if (!warnings.includes(name)) warnings.push(name);
                return asset;
            };
            const primaryImage = item.image !== undefined ? attach(item.image) : null;
            requireZip(item.triggers === undefined || Array.isArray(item.triggers), '暗号触发器无效');
            const triggers = (item.triggers || []).flatMap(trigger => {
                requireZip(trigger && ['text', 'stickerName', 'stickerId', 'imageFile', 'imageSha256'].includes(trigger.kind)
                    && text(trigger.value) && trigger.value.trim(), '暗号触发器无效');
                if (trigger.kind === 'imageSha256') {
                    requireZip(/^[0-9a-f]{64}$/i.test(trigger.value), '暗号图片 SHA-256 无效');
                    return [{ kind: trigger.kind, value: trigger.value.toLowerCase() }];
                }
                if (trigger.kind !== 'imageFile') return [{ kind: trigger.kind, value: trigger.value }];
                const asset = attach(trigger.value);
                return asset ? [{ kind: 'imageSha256', value: asset.sha256 }] : [];
            });
            if (primaryImage && !triggers.some(trigger => trigger.kind === 'imageSha256' && trigger.value === primaryImage.sha256)) {
                triggers.push({ kind: 'imageSha256', value: primaryImage.sha256 });
            }
            const meaning = item.meaning ?? '';
            const responseGuidance = item.responseGuidance ?? '';
            requireZip([meaning, responseGuidance].every(value => text(value) && !/<\/?[a-z][^>]*>/i.test(value)),
                '暗号含义和回应指引必须是纯文本');
            return {
                key: item.id, warnings, assets: [...assets.values()],
                entry: memoryRepository.validateEntry({
                    kind: 'code', title: item.name, meaning, responseGuidance,
                    triggers: [...new Map(triggers.map(trigger => [JSON.stringify(trigger), trigger])).values()],
                    keywords: item.tags, aliases: item.aliases, matchMode: item.matchMode,
                    priority: item.priority, permanent: item.permanent, expiresAt: item.expiresAt,
                    enabled: Boolean(meaning.trim()) && item.enabled !== false, source: 'import'
                })
            };
        });
    }

    async function preview(file, { signal, progress = () => {} } = {}) {
        requireZip(file.size <= limits.archive, 'ZIP 压缩大小超过上限');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const files = readDirectory(bytes);
        const visible = [...files].filter(([name]) => !name.endsWith('/')
            && !name.split('/').some(part => part.startsWith('.') || part === '__MACOSX'));
        const manifests = visible.filter(([name]) => name.split('/').at(-1) === 'manifest.json');
        requireZip(manifests.length <= 1, 'ZIP 内有多个 manifest.json');
        const manifestPath = manifests[0]?.[0];
        const prefix = manifestPath?.slice(0, manifestPath.lastIndexOf('/') + 1) ?? '';
        requireZip(!prefix || (prefix.split('/').length === 2 && visible.every(([name]) => name.startsWith(prefix))),
            'manifest.json 必须在 ZIP 根目录或唯一的顶层目录内');
        const images = new Map();
        let manifest;
        const imageCount = visible.filter(([name]) => Object.hasOwn(imageTypes, name.split('.').at(-1).toLowerCase())).length;
        requireZip(imageCount <= limits.images, 'ZIP 图片数量超过上限');
        let processed = 0;
        const included = new Set(visible.map(([name]) => name));
        for (const [name, entry] of files) {
            signal?.throwIfAborted();
            const data = await unpack(entry, signal);
            if (included.has(name)) {
                const extension = name.split('.').at(-1).toLowerCase();
                if (name === manifestPath) manifest = JSON.parse(decoder.decode(data));
                else if (Object.hasOwn(imageTypes, extension)) images.set(name, await inspectImage(name, data, imageTypes[extension]));
                else requireZip(/(^|\/)readme\.(md|txt)$/i.test(name), `ZIP 含不受支持的文件：${name}`);
            }
            progress(++processed, files.size);
            await pause();
        }
        signal?.throwIfAborted();
        const contentHash = await sha256(bytes);
        const entries = manifestPath ? parseEntries(manifest, prefix, images)
            : [...images].map(([name, asset]) => ({
                key: name, warnings: [], assets: [asset],
                entry: memoryRepository.validateEntry({
                    kind: 'code', title: asset.fileName.replace(/\.[^.]+$/, ''),
                    keywords: name.split('/').slice(0, -1), enabled: false, source: 'import',
                    triggers: [{ kind: 'imageSha256', value: asset.sha256 }]
                })
            }));
        requireZip(entries.length > 0, 'ZIP 没有可导入的暗号或图片');
        return { packId: manifest?.packId ?? `images-${contentHash}`, packName: manifest?.name ?? file.name,
            packVersion: 1, contentHash, entries, imageCount };
    }

    async function exportCodes(characterId, entryIds, includeImages) {
        const { entries, assets, packs } = await memoryRepository.getPackExport(characterId, entryIds);
        requireZip(entries.length > 0, '请选择要导出的暗号');
        const pack = packs.length === 1 && entries.every(entry => entry.packId === packs[0].packId) ? packs[0] : null;
        const packId = pack?.packId ?? `codes-${await sha256(encoder.encode(JSON.stringify(entries.map(entry => entry.id).sort())))}`;
        const files = Object.create(null);
        const records = [];
        for (const entry of entries) {
            const id = pack ? (entry.packEntryId ?? entry.id) : entry.id;
            const triggers = entry.triggers.filter(trigger => ['text', 'stickerName', 'stickerId', 'imageSha256'].includes(trigger.kind));
            let image;
            if (includeImages) {
                for (const asset of assets.filter(asset => asset.entryId === entry.id)) {
                    const extension = Object.keys(imageTypes).find(key => imageTypes[key] === asset.mimeType);
                    const path = `images/${asset.sha256}.${extension}`;
                    files[path] ??= new Uint8Array(await asset.blob.arrayBuffer());
                    image ??= path;
                    if (!triggers.some(trigger => trigger.kind === 'imageFile' && trigger.value === path)) {
                        triggers.push({ kind: 'imageFile', value: path });
                    }
                }
            }
            records.push({ id, type: 'code', name: entry.title, image, aliases: entry.aliases,
                triggers, meaning: entry.meaning, responseGuidance: entry.responseGuidance, matchMode: entry.matchMode,
                priority: entry.priority, permanent: entry.permanent, expiresAt: entry.expiresAt,
                enabled: entry.enabled, tags: entry.keywords });
        }
        files['manifest.json'] = encoder.encode(JSON.stringify({
            format, schemaVersion: 1, packId, name: pack?.packName ?? 'UwU 暗号包', entries: records
        }, null, 2));
        const outputs = Object.values(files);
        requireZip(records.length <= limits.files && outputs.length <= limits.images + 1
            && outputs.every(bytes => bytes.length <= limits.file), '导出的暗号包超过大小或数量上限');
        const archive = fflate.zipSync(files, { level: 0 });
        requireZip(archive.length <= limits.archive, '导出的 ZIP 超过大小上限');
        return new Blob([archive], { type: 'application/zip' });
    }

    async function readImage(file) {
        requireZip(file.size <= limits.file && Object.values(imageTypes).includes(file.type), '请选择支持的图片，最大 10 MB');
        return inspectImage(file.name, new Uint8Array(await file.arrayBuffer()), file.type);
    }

    return { preview, exportCodes, readImage };
})();
;
// 暗号包预览和确认流程，可从角色设置或长期记忆页打开。
const memoryZipUi = (() => {
    function element(tag, text, attributes = {}) {
        const node = Object.assign(document.createElement(tag), attributes);
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, action) {
        const control = element('button', label, { type: 'button', className: 'btn btn-neutral' });
        control.addEventListener('click', action);
        return control;
    }

    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = element('a', undefined, { href: url, download: filename });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function open(characterId) {
        const dialog = element('dialog', undefined, { className: 'uwu-memory-dialog' });
        const role = element('select');
        for (const character of db.characters) {
            role.add(element('option', character.remarkName || character.name || character.id, { value: character.id }));
        }
        role.value = characterId;
        const file = element('input', undefined, { type: 'file', accept: '.zip,application/zip' });
        const status = element('p');
        status.setAttribute('aria-live', 'polite');
        const previewArea = element('div');
        const exportList = element('fieldset');
        const urls = [];
        let controller;
        let preview;
        let busy = false;
        let listVersion = 0;

        function releaseImages() {
            urls.splice(0).forEach(url => URL.revokeObjectURL(url));
        }

        async function loadExportList() {
            const version = ++listVersion;
            const codes = await memoryRepository.list(role.value, 'code');
            if (version !== listVersion || !dialog.open) return;
            exportList.replaceChildren(element('legend', '选择要导出的暗号'));
            for (const code of codes) {
                const label = element('label');
                label.append(element('input', undefined, { type: 'checkbox', value: code.id }), ' ', code.title);
                exportList.append(label);
            }
            if (codes.length === 0) exportList.append(element('p', '该角色还没有暗号'));
        }

        const strategy = element('select');
        for (const [value, label] of [['skip', '跳过'], ['merge', '合并'], ['replace', '替换']]) {
            strategy.add(element('option', label, { value }));
        }
        const apply = button('确认导入', async () => {
            if (!preview || busy) return;
            const target = role.value;
            if (!confirm(`将暗号导入「${role.selectedOptions[0].textContent}」，重复项选择「${strategy.selectedOptions[0].textContent}」。继续吗？`)) return;
            busy = true;
            apply.disabled = role.disabled = file.disabled = true;
            try {
                const result = await memoryRepository.importPack(target, preview, strategy.value);
                status.textContent = `成功 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`;
                releaseImages();
                previewArea.replaceChildren();
                preview = undefined;
                file.value = '';
                await loadExportList();
            } catch (error) {
                status.textContent = `导入失败，已回滚：${error.message}`;
            } finally {
                busy = false;
                role.disabled = file.disabled = false;
                apply.disabled = !preview;
            }
        });
        apply.disabled = true;

        async function summarize() {
            const current = preview;
            const target = role.value;
            if (!current) return;
            const duplicates = await memoryRepository.getPackDuplicates(target, current);
            if (preview !== current || target !== role.value || !dialog.open) return;
            const warnings = current.entries.filter(item => item.warnings.length).length;
            status.textContent = `${current.packName} · 有效 ${current.entries.length} 条 · 图片 ${current.imageCount} 张 · 重复 ${duplicates} 条 · 缺图 ${warnings} 条`;
            apply.disabled = false;
        }

        file.addEventListener('change', async () => {
            controller?.abort();
            releaseImages();
            previewArea.replaceChildren();
            preview = undefined;
            apply.disabled = true;
            if (!file.files[0]) return;
            const current = new AbortController();
            controller = current;
            try {
                const result = await memoryZip.preview(file.files[0], {
                    signal: current.signal,
                    progress: (done, total) => { if (!current.signal.aborted) status.textContent = `校验文件 ${done}/${total}`; }
                });
                if (current.signal.aborted) return;
                preview = result;
                for (const item of result.entries) {
                    const row = element('article');
                    row.append(element('strong', item.entry.title));
                    for (const asset of item.assets) {
                        const url = URL.createObjectURL(asset.blob);
                        urls.push(url);
                        row.append(element('img', undefined, { src: url, width: 56, height: 56, alt: asset.fileName }));
                    }
                    row.append(element('p', item.entry.meaning || '草稿 · 待填写含义'));
                    if (item.warnings.length) row.append(element('p', `缺少图片：${item.warnings.join('、')}`));
                    previewArea.append(row);
                }
                await summarize();
            } catch (error) {
                if (!current.signal.aborted) status.textContent = error.message;
            }
        });

        role.addEventListener('change', async () => {
            apply.disabled = true;
            await Promise.all([loadExportList(), summarize()]).catch(error => { status.textContent = error.message; });
        });
        const includeImages = element('input', undefined, { type: 'checkbox', checked: true });
        const imageLabel = element('label');
        imageLabel.append(includeImages, ' 包含图片原文件');
        const exportButton = button('导出暗号 ZIP', async () => {
            exportButton.disabled = true;
            try {
                const ids = Array.from(exportList.querySelectorAll('input:checked'), input => input.value);
                download(await memoryZip.exportCodes(role.value, ids, includeImages.checked), 'UwU-暗号包.zip');
            } catch (error) {
                status.textContent = error.message;
            } finally {
                exportButton.disabled = false;
            }
        });
        dialog.addEventListener('close', () => {
            controller?.abort();
            releaseImages();
            dialog.remove();
        }, { once: true });
        const targetLabel = element('label', '目标角色 ');
        targetLabel.append(role);
        const strategyLabel = element('label', '重复项 ');
        strategyLabel.append(strategy);
        dialog.append(element('h2', '暗号 ZIP 导入与导出'), targetLabel, file, status,
            previewArea, strategyLabel, apply, exportList, imageLabel, exportButton,
            button('关闭', () => dialog.close()));
        document.body.append(dialog);
        dialog.showModal();
        loadExportList().catch(error => { status.textContent = error.message; });
    }

    return { open, element, button, download };
})();
;
const memoryImage = (() => {
    const size = 32;
    const frequencies = 8;
    const cache = new Map();
    const cosine = Array.from({ length: frequencies }, (_, k) => Array.from({ length: size }, (_, i) =>
        Math.cos(Math.PI * (i + 0.5) * k / size)));

    async function perceptualHash(blob) {
        const image = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
        try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.fillStyle = '#fff';
            context.fillRect(0, 0, size, size);
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, size, size).data;
            const luminance = Array.from({ length: size * size }, (_, i) =>
                pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114);
            if (Math.max(...luminance) - Math.min(...luminance) < 28) return '';
            const coefficients = [];
            for (let y = 0; y < frequencies; y++) {
                for (let x = 0; x < frequencies; x++) {
                    if (x === 0 && y === 0) continue;
                    let sum = 0;
                    for (let row = 0; row < size; row++) {
                        for (let col = 0; col < size; col++) sum += luminance[row * size + col] * cosine[x][col] * cosine[y][row];
                    }
                    coefficients.push(sum);
                }
            }
            const median = [...coefficients].sort((a, b) => a - b)[31];
            return coefficients.map(value => Number(value > median)).join('');
        } finally {
            image.close();
        }
    }

    function localBlob(data) {
        if (typeof data !== 'string' || data.length > 14 * 1024 * 1024
            || !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(data)) return null;
        const binary = atob(data.slice(data.indexOf(',') + 1));
        return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))]);
    }

    function assetHash(asset) {
        if (!cache.has(asset.sha256)) {
            if (cache.size >= 256) cache.delete(cache.keys().next().value);
            cache.set(asset.sha256, perceptualHash(asset.blob).catch(() => ''));
        }
        return cache.get(asset.sha256);
    }

    function distance(a, b) {
        let changes = 0;
        for (let i = 0; i < a.length; i++) changes += Number(a[i] !== b[i]);
        return changes;
    }

    async function match(characterId, entries, cue, now, usable) {
        const matches = new Set();
        if (!cue.imageSources.length) return matches;
        const ids = entries.filter(entry => entry.kind === 'code' && usable(entry, now) && entry.meaning.trim())
            .map(entry => entry.id);
        if (!ids.length) return matches;
        const { assets } = await memoryRepository.getPackExport(characterId, ids);
        if (!assets.length || assets.some(asset => cue.imageSha256.has(asset.sha256))) return matches;
        const references = [];
        for (const asset of assets) {
            const hash = await assetHash(asset);
            if (hash) references.push({ id: asset.entryId, hash });
        }
        for (const data of cue.imageSources) {
            try {
                const blob = localBlob(data);
                const hash = blob && await perceptualHash(blob);
                if (!hash) continue;
                const scores = new Map();
                for (const reference of references) {
                    scores.set(reference.id, Math.min(scores.get(reference.id) ?? Infinity, distance(hash, reference.hash)));
                }
                const [first, second] = [...scores].sort((a, b) => a[1] - b[1]);
                if (first && first[1] <= 6 && (!second || second[1] - first[1] >= 3)) matches.add(first[0]);
            } catch {
                // 损坏图片可继续走精确文本或表情包匹配。
            }
        }
        return matches;
    }

    return { match };
})();
;
const memoryEngine = (() => {
    const day = 86400000;
    const recallIntent = /还记得|记不记得|记得.*(?:那|以前)|回想|以前那次|上次那|想起来|do you remember|remember when/i;
    const normalize = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
    const usable = (entry, now) => entry.enabled && (entry.kind !== 'code' || entry.permanent
        || entry.expiresAt === null || entry.expiresAt > now);

    const styleDefinitions = {
        balanced: { label: '均衡', strength: 1, lifetime: 1,
            extraction: '优先收录重要经历、稳定事实与明确约定。' },
        fuzzy: { label: '偏模糊', strength: 0.65, lifetime: 0.55,
            extraction: '优先记住印象深的事件、反复出现的偏好和明确约定。摘要保留大意，略过琐碎细节。' },
        sharp: { label: '偏清晰', strength: 1.45, lifetime: 1.7,
            extraction: '优先记住重要经历和明确约定，也保留帮助日后回忆的具体人、地点、物品或原话。' }
    };

    function styleFor(character, mode = character?.memorySettings?.recallStyle ?? 'auto') {
        if (Object.hasOwn(styleDefinitions, mode)) return styleDefinitions[mode];
        if (mode !== 'auto') return styleDefinitions.balanced;
        const persona = typeof character?.persona === 'string' ? character.persona.replace(/并不健忘|不健忘|不迷糊|记性并不好/g, '') : '';
        const forgetful = /健忘|记性差|记忆力差|记不住|容易忘(?:记)?|(?:性格|为人|有点|经常|容易)(?:很|比较)?迷糊|^s*迷糊/.test(persona);
        const observant = /记性(?:很|特别|极)?好|记忆力(?:很|特别|极)?好|过目不忘|观察力强|善于观察|记得很清楚/.test(persona);
        if (forgetful === observant) return styleDefinitions.balanced;
        return forgetful ? styleDefinitions.fuzzy : styleDefinitions.sharp;
    }

    function rankReferences(entries, texts) {
        const clues = texts.map(normalize).filter(Boolean);
        return entries.map(entry => {
            const exact = relatedness(entry, clues);
            const alias = (entry.aliases || []).some(word => clues.some(line => containsTerm(line, normalize(word))));
            return { entry, score: exact * 2 + Number(alias) + (!exact ? vectorSimilarity(entry, clues) : 0) };
        }).filter(hit => hit.score >= 0.48)
            .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
            .map(hit => hit.entry);
    }

    function clarity(entry, now = Date.now(), style = styleDefinitions.balanced) {
        if (!entry) return 1;
        if (entry.pinned || entry.permanent || entry.kind === 'code') return 1;
        if (entry.recallClass === 'core' || entry.recallClass === 'agreement' || entry.recallClass === 'evolution') return 1;
        const anchor = entry.lastRecalledAt ?? entry.eventAt ?? entry.createdAt ?? now;
        const age = Math.max(0, (now - anchor) / day);
        const imp = Math.max(0, Math.min(1, Number.isFinite(entry.importance) ? entry.importance : 0.5));
        const recallBonus = Math.min(2.5, 1 + Math.max(0, entry.recallCount || 0) * 0.15);
        const baseHalfLife = 12 + Math.pow(imp, 1.6) * 165;
        const halfLife = Math.max(7, baseHalfLife * recallBonus * (style?.lifetime || 1));
        const baseStr = Number.isFinite(entry.baseStrength) ? entry.baseStrength : 0.7;
        return Math.min(1, baseStr * (style?.strength || 1) * 2 ** (-age / halfLife));
    }

    function clarityLabel(value) {
        if (value >= 0.6) return '清晰';
        return value >= 0.25 ? '有印象' : '模糊';
    }

    function matchCode(entry, cue, now = Date.now()) {
        if (entry.kind !== 'code' || !usable(entry, now) || !entry.meaning.trim()) return 0;
        const strengths = { stickerId: 5, stickerName: 4, imageSha256: 3, text: 2 };
        const texts = cue.text ? [...cue.text] : [];
        const hasText = term => {
            const needle = normalize(term);
            if (!needle) return false;
            return cue.text?.has(needle) || texts.some(line => containsTerm(line, needle));
        };
        let score = 0;
        for (const { kind, value } of entry.triggers) {
            const hit = kind === 'text' ? hasText(value) : cue[kind]?.has(normalize(value));
            if (hit) score = Math.max(score, strengths[kind] ?? 0);
        }
        if (!score && entry.matchMode === 'exact_then_alias'
            && entry.aliases.some(alias => hasText(alias))) return 1;
        return score;
    }

    function matchTextCode(entry, message) {
        return matchCode(entry, { text: new Set([normalize(message)]) });
    }

    async function localImageHash(data) {
        if (typeof data !== 'string' || data.length > 14 * 1024 * 1024
            || !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(data)) return '';
        try {
            const binary = atob(data.slice(data.indexOf(',') + 1));
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
            return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
        } catch {
            return '';
        }
    }

    function allowedStickerNames(character) {
        const groups = new Set((character.stickerGroups || '').split(/[,，]/).map(group => group.trim()));
        return new Set((db.myStickers || []).filter(sticker => groups.has(sticker.group || '未分类'))
            .map(sticker => normalize(sticker.name)));
    }

    function messageText(message) {
        if (typeof message.content === 'string') return normalize(message.content);
        return normalize(message.parts?.filter(part => part.type === 'text').map(part => part.text).join('\n'));
    }

    async function cuesFor(character, history, windowSize) {
        const messages = history.filter(message => message.role === 'user' || message.role === 'assistant');
        const recent = messages.filter(message => message.role === 'user').slice(-windowSize);
        const lastAssistant = messages.findLastIndex(message => message.role === 'assistant');
        const current = messages.slice(lastAssistant + 1).filter(message => message.role === 'user').slice(-windowSize);
        const cue = { text: new Set(), stickerId: new Set(), stickerName: new Set(), imageSha256: new Set() };
        const allowedNames = allowedStickerNames(character);
        const imageSources = new Set();
        for (const message of current) {
            const stickerName = normalize(message.content?.match?.(/^\[.*发送的表情包[：:]([^\]]+)\]$/)?.[1]);
            if (stickerName && (message.stickerId || message.stickerData) && allowedNames.has(stickerName)) {
                cue.stickerName.add(stickerName);
            }
            if (message.stickerId) cue.stickerId.add(normalize(message.stickerId));
            if (!stickerName) cue.text.add(messageText(message));
            if (message.stickerData) imageSources.add(message.stickerData);
            for (const part of message.parts || []) {
                if (part.type === 'image') imageSources.add(part.data);
            }
        }
        const hashes = await Promise.all([...imageSources].slice(-12).map(localImageHash));
        hashes.filter(Boolean).forEach(hash => cue.imageSha256.add(hash));
        cue.imageSources = [...imageSources].slice(-12);
        return { cue, recent: recent.map(messageText), current: [...cue.text], hasCurrent: current.length > 0 };
    }

    function containsTerm(message, term) {
        if (term.length < 2) return message === term;
        if (!/^[a-z0-9 ]+$/i.test(term)) return message.includes(term);
        return (` ${message.split(/[^a-z0-9]+/i).join(' ')} `).includes(` ${term} `);
    }

    function matchingTerms(entry, texts) {
        const matches = new Map();
        for (const value of [entry.title, ...entry.keywords, ...entry.people, ...entry.places, ...entry.objects]) {
            const term = normalize(value);
            if (term && !matches.has(term) && texts.some(message => containsTerm(message, term))) matches.set(term, value);
        }
        return matches;
    }

    const relatedness = (entry, texts) => matchingTerms(entry, texts).size;

    function codeReasons(entry, cue, similar) {
        const reasons = [];
        for (const { kind, value } of entry.triggers) {
            if (!cue[kind]?.has(normalize(value))) continue;
            if (kind === 'text') reasons.push(`暗号「${value}」`);
            if (kind === 'stickerName') reasons.push(`表情包「${value}」`);
            if (kind === 'stickerId') {
                const name = (db.myStickers || []).find(item => normalize(item.id) === normalize(value))?.name;
                reasons.push(name ? `表情包「${name}」` : '表情包匹配');
            }
            if (kind === 'imageSha256') reasons.push('图片完全匹配');
        }
        if (reasons.length) return [...new Set(reasons)];
        if (entry.matchMode === 'exact_then_alias') {
            const alias = entry.aliases.find(value => cue.text.has(normalize(value)));
            if (alias) return [`暗号别名「${alias}」`];
        }
        return similar ? ['本地相似图片'] : [];
    }

    async function retrieve(character, history, options = {}) {
        const now = options.now ?? Date.now();
        const windowSize = Math.max(1, Math.trunc(Number(options.recentWindow) || 4));
        const [entries, cues] = await Promise.all([
            memoryRepository.listForArchive(character.id, character.activeArchiveId),
            cuesFor(character, history, windowSize)
        ]);
        const similar = options.similarImages ? await memoryImage.match(character.id, entries, cues.cue, now, usable) : new Map();
        return rank(entries, cues, { ...options, now, style: styleFor(character, options.recallStyle) }, similar);
    }

    function rank(entries, cues, options, similar = new Map()) {
        const now = options.now ?? Date.now();
        if (!cues.hasCurrent) return [];
        const intentional = cues.current.some(message => recallIntent.test(message));
        const results = [];
        for (const entry of entries) {
            if (!usable(entry, now)) continue;
            const strength = clarity(entry, now, options.style);
            if (entry.kind === 'code') {
                const code = matchCode(entry, cues.cue, now) || (similar.has(entry.id) ? 0.5 : 0);
                if (code) results.push({ entry, clarity: strength, explicit: true,
                    score: (options.preferCodes === false ? 1 : 15) + code + Math.atan(entry.priority) / Math.PI,
                    ...(options.debug ? { reasons: codeReasons(entry, cues.cue, similar.has(entry.id)) } : {}) });
                continue;
            }
            const direct = relatedness(entry, cues.current);
            const clues = intentional ? cues.recent : cues.current;
            const terms = matchingTerms(entry, clues);
            const matches = terms.size;
            const similarity = !matches && options.localVectors ? vectorSimilarity(entry, clues) : 0;
            if (entry.recallClass === 'evolution') {
                const recency = Math.min(1, ((entry.eventAt ?? entry.updatedAt ?? 0) / 1e13));
                results.push({ entry, clarity: 1, explicit: Boolean(matches),
                    score: 12 + recency + entry.importance + Math.min(2, matches),
                    ...(options.debug ? { reasons: matches
                        ? ['角色成长变化常驻', ...[...terms.values()].map(term => `关键词「${term}」`)]
                        : ['角色成长变化常驻'] } : {}) });
                continue;
            }
            if (!matches && similarity < 0.48) continue;
            results.push({ entry, clarity: strength, explicit: intentional && Boolean(matches),
                score: Number(intentional && Boolean(matches)) * 4 + Math.min(4, matches) + Math.min(2, direct)
                    + similarity + entry.importance + Math.min(0.4, strength),
                ...(options.debug ? { reasons: matches
                    ? [...terms.values()].map(term => `关键词「${term}」`)
                    : ['本地文本相似'] } : {}) });
        }
        results.sort((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt);
        // 1-hop associative recall: surface linked memories of top direct hits
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        const seenIds = new Set(results.map(hit => hit.entry.id));
        const seeds = results.filter(hit => hit.entry.kind !== 'code' && hit.entry.recallClass !== 'evolution').slice(0, 3);
        const linkedHits = [];
        for (const seed of seeds) {
            const links = Array.isArray(seed.entry.linkedEntryIds) ? seed.entry.linkedEntryIds : [];
            for (const targetId of links) {
                if (seenIds.has(targetId)) continue;
                const linked = byId.get(targetId);
                if (!linked || !usable(linked, now) || linked.kind === 'code') continue;
                const linkedStrength = clarity(linked, now, options.style);
                if (linked.kind === 'event' && linkedStrength < 0.25 && linked.recallClass === 'ordinary') continue;
                seenIds.add(targetId);
                linkedHits.push({
                    entry: linked,
                    clarity: linkedStrength,
                    explicit: false,
                    score: Math.max(1.2, seed.score * 0.65) + linked.importance * 0.3,
                    ...(options.debug ? { reasons: [`由「${seed.entry.title}」联想触发`] } : {})
                });
            }
        }
        if (linkedHits.length) {
            results.push(...linkedHits);
            results.sort((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt);
        }
        return results;
    }

    function grams(text) {
        const features = new Set();
        for (const word of normalize(text).slice(0, 1800).match(/[a-z0-9]+|[\p{Script=Han}]+/gu) || []) {
            if (/^[a-z0-9]+$/.test(word)) {
                if (word.length >= 3) features.add(word);
            } else {
                const characters = [...word];
                for (let i = 1; i < characters.length; i++) features.add(characters[i - 1] + characters[i]);
            }
        }
        return features;
    }

    function vectorSimilarity(entry, texts) {
        const reference = grams([entry.title, entry.summary, ...entry.keywords].join(' '));
        if (!reference.size) return 0;
        let best = 0;
        for (const text of texts) {
            const query = grams(text);
            const shared = [...query].filter(word => reference.has(word)).length;
            if (shared >= 2) best = Math.max(best, shared / Math.sqrt(query.size * reference.size));
        }
        return best;
    }

    function retrieveGroup(group, history) {
        const config = group.sharedMemory;
        if (!config?.enabled || !Array.isArray(config.entries)) return [];
        const members = new Map((group.members || []).map(member => [member.id, member]));
        const entries = [];
        for (const entry of config.entries) {
            if (!entry || (entry.memberId && !members.has(entry.memberId)) || !['event', 'fact'].includes(entry.kind)) continue;
            try {
                entries.push({ ...entry, ...memoryRepository.validateEntry(entry) });
            } catch {
                // 旧备份中的异常条目不会影响群聊回复。
            }
        }
        const context = history.filter(message => ['user', 'assistant'].includes(message.role));
        const current = context.slice(context.findLastIndex(message => message.role === 'assistant') + 1).slice(-4).map(messageText);
        const recent = context.filter(message => message.role === 'user').slice(-4).map(messageText);
        return rank(entries, { hasCurrent: current.length > 0, current, recent }, {}).map(hit => {
            const member = members.get(hit.entry.memberId);
            return member ? { ...hit, entry: { ...hit.entry,
                title: `${member.groupNickname || member.remarkName || member.realName || member.name} · ${hit.entry.title}` } } : hit;
        });
    }

    return { retrieve, retrieveGroup, clarity, clarityLabel, matchTextCode, styleFor, rankReferences };
})();
;
const memoryViews = (() => {
    const { element, button } = memoryZipUi;

    async function timeline(pane, character, version, onSelect) {
        const before = version();
        pane.replaceChildren();
        const allEntries = await memoryRepository.listForArchive(character.id, character.activeArchiveId);
        if (before !== version()) return;
        const entries = allEntries.filter(entry => entry.kind !== 'code');
        const guide = element('p', '按发生日期浏览角色经历、重要约定与成长变化。点击任意卡片即可直接编辑日期或细节。', { className: 'uwu-memory-guide' });
        const filter = element('select');
        for (const [k, v] of Object.entries({ all: '全部记忆（含约定与变化）', event: '仅情景记忆', key: '仅重要约定与成长变化', clear: '仅看清晰记忆' })) {
            filter.add(element('option', v, { value: k }));
        }
        const style = memoryEngine.styleFor(character);
        const container = element('div');
        const fmtDate = new Intl.DateTimeFormat(document.documentElement.lang || 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
        const fmtDateTime = ts => {
            const d = new Date(ts);
            const datePart = fmtDate.format(d);
            if (d.getHours() === 0 && d.getMinutes() === 0) return datePart;
            return `${datePart} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };
        const fmtMonth = ts => {
            const d = new Date(ts);
            return `${d.getFullYear()}年${d.getMonth() + 1}月`;
        };
        const classLabel = { agreement: ['重要约定', 'uwu-badge-agreement'], evolution: ['成长变化', 'uwu-badge-evolution'], core: ['核心设定', 'uwu-badge-core'] };
        const clarityCls = { '清晰': 'uwu-badge-clear', '有印象': 'uwu-badge-impression', '模糊': 'uwu-badge-fuzzy' };

        const draw = () => {
            const mode = filter.value;
            const visible = entries.filter(entry => {
                if (mode === 'event') return entry.kind === 'event';
                if (mode === 'key') return entry.recallClass === 'agreement' || entry.recallClass === 'evolution';
                if (mode === 'clear') return memoryEngine.clarityLabel(memoryEngine.clarity(entry, Date.now(), style)) === '清晰';
                return true;
            });
            const dated = visible.filter(entry => entry.eventAt !== null).sort((a, b) => b.eventAt - a.eventAt);
            const undated = visible.filter(entry => entry.eventAt === null);
            container.replaceChildren();
            if (!visible.length) {
                container.append(element('p', '当前筛选下暂无记忆'));
                return;
            }
            let currentMonth = '';
            let list = null;
            for (const entry of [...dated, ...undated]) {
                const month = entry.eventAt !== null ? fmtMonth(entry.eventAt) : '日期待补充';
                if (month !== currentMonth) {
                    currentMonth = month;
                    container.append(element('div', month, { className: 'uwu-memory-timeline-month' }));
                    list = element('ol', undefined, { className: 'uwu-memory-timeline' });
                    container.append(list);
                }
                const point = element('li', undefined, { className: onSelect ? 'is-clickable' : '' });
                const cLbl = memoryEngine.clarityLabel(memoryEngine.clarity(entry, Date.now(), style));
                const badges = element('div', undefined, { className: 'uwu-memory-badges' });
                badges.append(element('span', entry.eventAt !== null ? fmtDateTime(entry.eventAt) : '未填日期', { className: 'uwu-badge uwu-badge-date' }));
                badges.append(element('span', cLbl, { className: `uwu-badge ${clarityCls[cLbl] || 'uwu-badge-fuzzy'}` }));
                if (classLabel[entry.recallClass]) {
                    badges.append(element('span', classLabel[entry.recallClass][0], { className: `uwu-badge ${classLabel[entry.recallClass][1]}` }));
                }
                if (entry.linkedEntryIds?.length) {
                    badges.append(element('span', `关联 ${entry.linkedEntryIds.length}`, { className: 'uwu-badge uwu-badge-date' }));
                }
                point.append(badges, element('strong', entry.title));
                if (entry.summary) point.append(element('p', entry.summary));
                if (onSelect) {
                    point.title = '点击编辑此条记忆';
                    point.addEventListener('click', () => onSelect(entry));
                }
                list.append(point);
            }
        };
        filter.addEventListener('change', draw);
        pane.append(guide, filter, container);
        draw();
    }

    async function relations(pane, character, version, onSelect) {
        const before = version();
        pane.replaceChildren();
        const entries = await memoryRepository.listForArchive(character.id, character.activeArchiveId);
        if (before !== version()) return;
        const guide = element('p', '搜索并选择任意一条记忆，查看它与其他记忆的双向关联网络。聊天命中主记忆时会自动联想高清晰关联记忆。', { className: 'uwu-memory-guide' });
        if (!entries.length) {
            pane.append(guide, element('p', '暂无关联记忆'));
            return;
        }
        const search = element('input', undefined, { type: 'search', placeholder: '输入关键词筛选中心记忆…' });
        const source = element('select');
        const result = element('section', undefined, { className: 'uwu-memory-relations' });
        result.setAttribute('aria-live', 'polite');
        const byId = new Map(entries.map(entry => [entry.id, entry]));

        const refillSelect = (preferredId) => {
            const q = search.value.trim().toLowerCase();
            const prev = preferredId || source.value;
            const filtered = entries.filter(e => !q || e.title.toLowerCase().includes(q) || (e.keywords || []).some(k => k.toLowerCase().includes(q)));
            source.replaceChildren();
            for (const entry of filtered) {
                const cnt = (entry.linkedEntryIds || []).length;
                source.add(element('option', `${entry.title}${cnt ? `（${cnt}条关联）` : ''}`, { value: entry.id }));
            }
            if (prev && filtered.some(e => e.id === prev)) source.value = prev;
        };

        function draw() {
            const node = byId.get(source.value);
            if (!node) {
                result.replaceChildren(element('p', '没有匹配的记忆'));
                return;
            }
            result.replaceChildren();
            const focusBox = element('div', undefined, { className: 'uwu-memory-rel-focus' });
            focusBox.append(element('strong', node.title));
            if (node.summary || node.meaning) focusBox.append(element('p', node.summary || node.meaning, { style: 'margin:6px 0;font-size:.86rem;color:#4a4356;' }));
            if (onSelect) focusBox.append(button('编辑此条记忆', () => onSelect(node)));
            result.append(focusBox);

            const outgoing = new Set(node.linkedEntryIds || []);
            const connected = entries.filter(entry => entry.id !== node.id && (outgoing.has(entry.id) || (entry.linkedEntryIds || []).includes(node.id)));
            if (!connected.length) {
                result.append(element('p', '此条记忆暂无关联，可点击上方「编辑此条记忆」快速勾选关联项。'));
                return;
            }
            result.append(element('p', `共 ${connected.length} 条关联记忆`, { style: 'font-size:.84rem;color:#666;margin:6px 0;' }));
            for (const entry of connected) {
                const direction = outgoing.has(entry.id) && (entry.linkedEntryIds || []).includes(node.id) ? '双向关联'
                    : outgoing.has(entry.id) ? '关联至' : '被关联自';
                const row = element('div', undefined, { className: 'uwu-memory-rel-card' });
                const info = element('div');
                info.append(element('span', direction, { className: 'uwu-badge uwu-badge-date', style: 'margin-right:6px;' }),
                    element('strong', entry.title, { style: 'font-size:.88rem;' }));
                const acts = element('div', undefined, { className: 'uwu-memory-rel-actions' });
                acts.append(button('聚焦', () => {
                    search.value = '';
                    refillSelect(entry.id);
                    source.value = entry.id;
                    draw();
                }));
                if (onSelect) acts.append(button('编辑', () => onSelect(entry)));
                row.append(info, acts);
                result.append(row);
            }
        }

        search.addEventListener('input', () => { refillSelect(); draw(); });
        source.addEventListener('change', draw);
        refillSelect();
        pane.append(guide, search, source, result);
        draw();
    }

    return { timeline, relations };
})();
;
// 群内成员标注使用群对象自己的存储空间。
const memoryGroup = (() => {
    const { element, button } = memoryZipUi;
    const memberName = member => member.groupNickname || member.remarkName || member.realName || member.name || member.id;

    function open(group) {
        const dialog = element('dialog', undefined, { className: 'uwu-memory-dialog' });
        const form = element('form');
        const enabled = element('input', undefined, { type: 'checkbox', checked: group.sharedMemory?.enabled === true });
        const list = element('section');
        const status = element('p');
        status.setAttribute('role', 'status');
        const members = new Map((group.members || []).map(member => [member.id, member]));
        let entries = [...(Array.isArray(group.sharedMemory?.entries) ? group.sharedMemory.entries : [])];
        let busy = false;

        function field(name, control) {
            const label = element('label', name);
            label.append(control);
            form.append(label);
            return control;
        }

        field('启用群聊记忆', enabled);
        const member = field('归属成员', element('select'));
        member.add(element('option', '全体成员', { value: '' }));
        for (const [id, item] of members) member.add(element('option', memberName(item), { value: id }));
        const name = field('名称', element('input', undefined, { required: true, maxLength: 100 }));
        const summary = field('摘要', element('textarea', undefined, { required: true, maxLength: 450 }));
        const keywords = field('关键词（逗号分隔）', element('input', undefined, { maxLength: 400 }));
        const saveEntry = element('button', '添加记忆', { type: 'submit', className: 'btn btn-primary' });
        form.append(saveEntry);
        let editing;

        function render() {
            list.replaceChildren();
            for (const entry of entries) {
                const row = element('article');
                const owner = entry.memberId ? (members.has(entry.memberId) ? memberName(members.get(entry.memberId)) : '成员已离群') : '全体成员';
                row.append(element('strong', entry.title), element('p', owner + ' · ' + entry.summary),
                    button('编辑', () => {
                        if (busy) return;
                        editing = entry.id;
                        name.value = entry.title;
                        summary.value = entry.summary;
                        keywords.value = entry.keywords.join('，');
                        member.value = members.has(entry.memberId) ? entry.memberId : '';
                        saveEntry.textContent = '更新记忆';
                        name.focus();
                    }),
                    button('删除', () => {
                        if (busy || !confirm(`删除群聊记忆「${entry.title}」？`)) return;
                        persist(entries.filter(item => item.id !== entry.id));
                    }));
                list.append(row);
            }
        }

        async function persist(next) {
            if (busy) return false;
            busy = true;
            const before = group.sharedMemory;
            try {
                if (!db.groups.includes(group)) throw new Error('该群已删除');
                group.sharedMemory = { enabled: enabled.checked, entries: next };
                await saveData();
                entries = next;
                render();
                status.textContent = '群聊记忆已保存';
                return true;
            } catch (error) {
                group.sharedMemory = before;
                status.textContent = error.message;
                return false;
            } finally {
                busy = false;
            }
        }

        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            try {
                const previous = entries.find(entry => entry.id === editing);
                const now = Date.now();
                const entry = { ...memoryRepository.validateEntry({
                    kind: 'fact', title: name.value, summary: summary.value.trim(),
                    keywords: keywords.value.split(/[,，]/).map(word => word.trim()).filter(Boolean)
                }), id: previous?.id ?? crypto.randomUUID(), memberId: member.value || null,
                    createdAt: previous?.createdAt ?? now, updatedAt: now };
                if (!await persist(previous ? entries.map(item => item.id === previous.id ? entry : item) : [...entries, entry])) return;
                name.value = summary.value = keywords.value = member.value = '';
                editing = undefined;
                saveEntry.textContent = '添加记忆';
            } catch (error) {
                status.textContent = error.message;
            }
        });
        dialog.append(element('h2', '群聊记忆'), element('p', group.name),
            element('p', '本群所有 AI 成员共享请求上下文。成员归属用于标注每条记忆。'),
            form, button('保存开关', () => persist(entries)), list, status, button('关闭', () => dialog.close()));
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog);
        dialog.showModal();
        render();
    }

    function validateMemory(memory) {
        if (!memory || typeof memory.enabled !== 'boolean' || !Array.isArray(memory.entries)) throw new Error('群聊记忆备份无效');
        const ids = new Set();
        const entries = memory.entries.map(entry => {
            if (!entry || !['fact', 'event'].includes(entry.kind) || typeof entry.id !== 'string' || !entry.id.trim()
                || ids.has(entry.id) || (entry.memberId !== null && typeof entry.memberId !== 'string')
                || !Number.isSafeInteger(entry.createdAt) || !Number.isSafeInteger(entry.updatedAt)) throw new Error('群聊记忆条目无效');
            ids.add(entry.id);
            return { ...memoryRepository.validateEntry(entry), id: entry.id, memberId: entry.memberId,
                createdAt: entry.createdAt, updatedAt: entry.updatedAt };
        });
        return { enabled: memory.enabled, entries };
    }

    function prepareBackups(backups, groupIds) {
        if (!Array.isArray(backups)) throw new Error('群聊记忆备份无效');
        const seen = new Set();
        const prepared = new Map();
        for (const backup of backups) {
            if (typeof backup?.groupId !== 'string' || seen.has(backup.groupId)) throw new Error('群聊记忆备份含重复或无效群 ID');
            seen.add(backup.groupId);
            const memory = validateMemory(backup.memory);
            if (groupIds.has(backup.groupId)) prepared.set(backup.groupId, memory);
        }
        return { prepared, missing: seen.size - prepared.size };
    }

    return { open, validateMemory, prepareBackups };
})();
;
const memoryReferencePicker = (() => {
    const { element } = memoryZipUi;
    const types = { event: '情景记忆', fact: '稳定事实', code: '暗号' };
    const labels = {
        none: '只发送所选聊天', relevant: '自动挑相关（推荐）', dates: '按记忆日期范围',
        library: '从整个记忆库按预算选', manual: '手动勾选'
    };

    function field(text, input) {
        const label = element('label', text);
        label.append(input);
        return label;
    }

    function select(choices, value) {
        const input = element('select');
        for (const [key, label] of Object.entries(choices)) input.add(element('option', label, { value: key }));
        input.value = value;
        return input;
    }

    function create(characterId, archiveId) {
        const container = element('details', undefined, { className: 'uwu-memory-reference-picker' });
        const heading = '选填 · 随本批发送已有记忆';
        const header = element('summary', heading);
        const mode = select(labels, 'none');
        const budget = select({ 300: '约 300 Token', 600: '约 600 Token', 1200: '约 1200 Token' }, '600');
        const budgetRow = field('额外记忆预算', budget);
        const from = element('input', undefined, { type: 'date' });
        const to = element('input', undefined, { type: 'date' });
        const dates = element('div');
        dates.append(field('记忆开始日期', from), field('记忆结束日期', to));
        const status = element('p');
        status.setAttribute('role', 'status');
        const list = element('div', undefined, { className: 'uwu-memory-reference-list' });
        const preview = element('details');
        const transmitted = element('div', undefined, { className: 'uwu-memory-reference-list' });
        preview.append(element('summary', '查看将发送的记忆摘要'), transmitted);
        container.append(header, field('已有记忆发送方式', mode), budgetRow, dates, status, list, preview);

        let entries = [];
        let messages = [];
        let selected = [];
        let loaded = false;
        let loadFailed = false;
        let busy = false;
        const manual = new Set();
        let renderedManual = false;

        function renderManual() {
            if (renderedManual || !loaded) return;
            renderedManual = true;
            for (const entry of entries) {
                const reference = memoryBatch.referenceFor(entry);
                const box = element('input', undefined, { type: 'checkbox', disabled: busy });
                box.addEventListener('change', () => {
                    if (box.checked) manual.add(entry.id);
                    else manual.delete(entry.id);
                    redraw();
                });
                const row = element('div');
                row.append(field(`${types[entry.kind]} · ${reference.title}`, box));
                if (reference.summary) row.append(element('p', reference.summary));
                list.append(row);
            }
        }

        function shortlist() {
            if (mode.value === 'none') return [];
            if (mode.value === 'manual') return entries.filter(entry => manual.has(entry.id));
            if (mode.value === 'relevant') return memoryEngine.rankReferences(entries, messages.map(message => message.text));
            if (mode.value === 'dates') {
                if (!from.value && !to.value) return [];
                const min = from.value ? Date.parse(from.value) : -Infinity;
                const max = to.value ? Date.parse(to.value) + 86400000 : Infinity;
                return entries.filter(entry => {
                    const date = entry.eventAt ?? entry.createdAt;
                    return date >= min && date < max;
                });
            }
            return entries;
        }

        function redraw() {
            const isNone = mode.value === 'none';
            budgetRow.hidden = isNone;
            dates.hidden = mode.value !== 'dates';
            list.hidden = mode.value !== 'manual';
            if (mode.value === 'manual') renderManual();
            const candidates = shortlist();
            selected = memoryBatch.fitReferences(candidates, Number(budget.value));
            header.textContent = selected.length ? `${heading}（${selected.length} 条）` : heading;
            preview.hidden = !selected.length;
            status.textContent = isNone ? '本批只发送选定的聊天文本。'
                : loadFailed ? '已有记忆加载失败。'
                : !loaded ? '正在加载已有记忆…'
                : mode.value === 'dates' && !from.value && !to.value ? '至少选择一个日期。日期以事件日为准，未填写事件日时使用记录创建日。'
                : mode.value === 'dates' && from.value && to.value && from.value > to.value ? '结束日期应晚于或等于开始日期。'
                : `发送 ${selected.length} / ${candidates.length} 条摘要，约 ${memoryBatch.referenceTokens(selected)} Token。`;
            transmitted.replaceChildren();
            for (const reference of selected) {
                const row = element('article');
                row.append(element('strong', reference.title));
                if (reference.summary) row.append(element('p', reference.summary));
                transmitted.append(row);
            }
        }

        for (const control of [mode, budget, from, to]) control.addEventListener('change', redraw);
        memoryRepository.listForArchive(characterId, archiveId).then(result => {
            entries = result.filter(entry => entry.enabled)
                .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
            loaded = true;
            redraw();
        }).catch(() => {
            loadFailed = true;
            redraw();
        });
        redraw();

        return {
            element: container,
            selected: () => selected,
            ready: () => mode.value === 'none' || (loaded && (
                mode.value !== 'dates' || ((from.value || to.value) && (!from.value || !to.value || from.value <= to.value))
            )),
            updateMessages(next) { messages = next; redraw(); },
            setBusy(value) {
                busy = value;
                for (const control of container.querySelectorAll('input, select')) control.disabled = value;
            }
        };
    }

    return { create };
})();
;
const memoryManagement = (() => {
    const { element, button, download } = memoryZipUi;
    const recallClasses = { ordinary: '普通记忆', agreement: '重要约定', core: '核心设定', evolution: '成长变化' };
    const libraryCategories = { all: '全部记忆', core: recallClasses.core, agreement: recallClasses.agreement, evolution: recallClasses.evolution };
    const categoryHelp = {
        core: '保存角色需要长期记住的人设、关系或背景。与聊天相关时单独发送。',
        agreement: '保存双方说好的事，例如见面计划、承诺或相处习惯。与聊天相关时单独发送。',
        evolution: '记录角色随时间推进的动态进步与变化（如语言/线上打字习惯、工作与收入、生活状态、相处方式等）。最新节点会优先覆盖初始人设并持续生效。'
    };
    const typeNames = { event: '情景记忆', fact: '稳定事实', code: '暗号' };
    const defaults = { enabled: false, maxEntries: 3, tokenBudget: 300, recentWindow: 4,
        preferCodes: true, legacyJournalInjection: false, debug: false, autoOrganize: false, batchSize: 30, callMemory: false, localVectors: false, similarImages: false, autoIntervalMinutes: 5, batchMaxCandidates: 5, recallStyle: 'auto', organizeStylePrompt: '' };
    const settingsFor = character => ({ ...defaults, ...character?.memorySettings });
    let dispose;
    const split = value => value.split(/[\n,，]+/).map(word => word.trim()).filter(Boolean);

    function field(label, control) {
        const wrapper = element('label', label);
        wrapper.append(control);
        return wrapper;
    }

    function select(options, value) {
        const control = element('select');
        for (const [key, label] of Object.entries(options)) control.add(element('option', label, { value: key }));
        control.value = value;
        return control;
    }

    function scopeLabel(character, archiveId) {
        if (!archiveId) return '角色通用';
        const archive = character.archives?.find(item => item.id === archiveId);
        return archive ? `仅存档「${archive.name}」` : '原存档不可用';
    }

    function edit(character, kind, existing, afterSave, copy = false, initialClass = 'ordinary') {
        const { id: characterId } = character;
        const editor = element('dialog', undefined, { className: 'uwu-memory-dialog' });
        const form = element('form');
        const status = element('p');
        status.setAttribute('role', 'status');
        const controls = {};
        function input(key, label, type = 'text', defaultValue = '') {
            const options = type === 'textarea' ? {} : { type };
            const control = element(type === 'textarea' ? 'textarea' : 'input', undefined, options);
            const value = existing?.[key] ?? defaultValue;
            if (type === 'checkbox') control.checked = value;
            else if (type === 'date') control.value = value ? new Date(value).toISOString().slice(0, 10) : '';
            else if (type === 'datetime-local') {
                if (typeof value === 'string') control.value = value;
                else if (value) {
                    const d = new Date(value);
                    control.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                } else control.value = '';
            }
            else if (Array.isArray(value)) control.value = value.join('，');
            else if (type !== 'file') control.value = value;
            controls[key] = control;
            form.append(field(label, control));
            return control;
        }
        function addSelect(key, label, items, defaultValue) {
            const control = select(items, existing?.[key] ?? defaultValue);
            controls[key] = control;
            form.append(field(label, control));
        }
        input('title', '名称').required = true;
        if (copy) controls.title.value += '（副本）';
        let stickerIds;
        input('keywords', '关键词（逗号分隔）');
        input('pinned', '锁定', 'checkbox', false);
        const activeArchive = getActiveArchive(character);
        const scopes = { '': '角色通用', [activeArchive.id]: `仅当前存档（${activeArchive.name}）` };
        if (existing?.archiveId && !Object.hasOwn(scopes, existing.archiveId)) {
            scopes[existing.archiveId] = scopeLabel(character, existing.archiveId);
        }
        addSelect('archiveId', '记忆范围', scopes, '');
        if (kind === 'code') {
            input('meaning', '约定含义', 'textarea');
            input('responseGuidance', '角色回应指引', 'textarea');
            input('aliases', '别名（逗号分隔）');
            const triggers = existing?.triggers.filter(trigger => trigger.kind === 'text').map(trigger => trigger.value) ?? [];
            input('textTriggers', '触发词（每行一条）', 'textarea', triggers.join('\n'));
            stickerIds = element('select', undefined, { multiple: true, size: 3 });
            const existingIds = new Set(existing?.triggers.filter(trigger => trigger.kind === 'stickerId').map(trigger => trigger.value));
            const groups = new Set((character.stickerGroups || '').split(/[,，]/).map(group => group.trim()));
            const options = new Map((db.myStickers || [])
                .filter(sticker => sticker.id && groups.has(sticker.group || '未分类'))
                .map(sticker => [sticker.id, sticker.name]));
            for (const id of existingIds) if (!options.has(id)) options.set(id, `原表情包 ${id}`);
            for (const [id, name] of options) stickerIds.add(element('option', name, { value: id, selected: existingIds.has(id) }));
            if (options.size) form.append(field('表情包触发（可多选）', stickerIds));
            addSelect('matchMode', '匹配方式', { exact: '精确', exact_then_alias: '精确与别名' }, 'exact_then_alias');
            input('priority', '优先级', 'number', 0);
            input('permanent', '固定暗号', 'checkbox', true);
            input('expiresAt', '过期日期', 'date', '');
            input('enabled', '启用暗号', 'checkbox', true);
            const image = input('image', '上传或替换图片', 'file');
            image.accept = 'image/png,image/jpeg,image/webp,image/gif';
        } else {
            addSelect('recallClass', '记忆分类', recallClasses, initialClass);
            input('summary', '简短摘要', 'textarea');
            input('details', '细节', 'textarea');
            input('enabled', '允许检索与整理引用', 'checkbox', true);
            const nowLocal = (() => {
                const d = new Date();
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            })();
            input('eventAt', '事件时间（精确到小时分钟）', 'datetime-local', existing ? '' : nowLocal);
            const importance = input('importance', '重要程度（0–1）', 'number', 0.5);
            Object.assign(importance, { step: '0.05', min: '0', max: '1', required: true });
            const curClarity = existing && kind === 'event'
                ? memoryEngine.clarityLabel(memoryEngine.clarity(existing, Date.now(), memoryEngine.styleFor(character))) : '';
            const curClarityKey = curClarity === '清晰' ? 'clear' : curClarity === '有印象' ? 'impression' : curClarity === '模糊' ? 'fuzzy' : 'auto';
            addSelect('clarityPreset', '回忆清晰度（快捷设定）', {
                auto: '保持原样 / 自动',
                clear: '清晰（记得很清楚）',
                impression: '有印象（记得大概）',
                fuzzy: '模糊（只剩零星印象）'
            }, existing ? curClarityKey : 'auto');
        }
        const selectedLinks = new Set(existing?.linkedEntryIds ?? []);
        const linkPicker = element('div', undefined, { className: 'uwu-memory-link-picker' });
        const linkHead = element('div', undefined, { className: 'uwu-memory-link-picker-head' });
        const linkCount = element('span', `已选 ${selectedLinks.size} 条`);
        linkHead.append(element('span', '关联记忆（可搜索勾选）'), linkCount);
        const linkSearch = element('input', undefined, { type: 'search', placeholder: '输入标题或关键词筛选关联记忆…' });
        const linkList = element('div', undefined, { className: 'uwu-memory-link-picker-list' });
        linkPicker.append(linkHead, linkSearch, linkList);
        form.append(linkPicker);
        let linkCandidates = [];
        const renderLinkPicker = () => {
            const q = linkSearch.value.trim().toLowerCase();
            linkCount.textContent = `已选 ${selectedLinks.size} 条`;
            const filtered = linkCandidates.filter(entry =>
                !q || entry.title.toLowerCase().includes(q)
                || (entry.keywords || []).some(k => k.toLowerCase().includes(q))
                || (entry.summary || '').toLowerCase().includes(q)
            ).sort((a, b) => Number(selectedLinks.has(b.id)) - Number(selectedLinks.has(a.id)));
            linkList.replaceChildren();
            if (!filtered.length) {
                linkList.append(element('span', '没有匹配的记忆', { style: 'font-size:.82rem;color:#888;padding:4px;' }));
                return;
            }
            for (const entry of filtered) {
                const checked = selectedLinks.has(entry.id);
                const row = element('label', undefined, { className: `uwu-memory-link-picker-item${checked ? ' is-selected' : ''}` });
                const cb = element('input', undefined, { type: 'checkbox', checked });
                cb.addEventListener('change', () => {
                    if (cb.checked) selectedLinks.add(entry.id);
                    else selectedLinks.delete(entry.id);
                    row.classList.toggle('is-selected', cb.checked);
                    linkCount.textContent = `已选 ${selectedLinks.size} 条`;
                });
                const dateTag = entry.eventAt ? ` (${new Date(entry.eventAt).toLocaleDateString()})` : '';
                row.append(cb, element('span', `${entry.title}${dateTag}`));
                linkList.append(row);
            }
        };
        linkSearch.addEventListener('input', renderLinkPicker);
        memoryRepository.list(characterId).then(entries => {
            linkCandidates = entries.filter(entry => entry.id !== existing?.id);
            renderLinkPicker();
        }).catch(error => { status.textContent = error.message; });
        const save = element('button', '保存', { type: 'submit', className: 'btn btn-primary' });
        form.append(save, status);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (save.disabled) return;
            save.disabled = true;
            const value = key => controls[key].value;
            const date = key => value(key) ? Date.parse(value(key)) : null;
            const record = { kind, title: value('title'), keywords: split(value('keywords')),
                pinned: controls.pinned.checked, archiveId: value('archiveId') || null, linkedEntryIds: [...selectedLinks] };
            try {
                if (kind === 'code') {
                    const keepTriggers = existing?.triggers.filter(trigger => !['text', 'stickerId'].includes(trigger.kind)) ?? [];
                    Object.assign(record, {
                        meaning: value('meaning'), responseGuidance: value('responseGuidance'), aliases: split(value('aliases')),
                        triggers: [...keepTriggers, ...Array.from(stickerIds.selectedOptions, option => ({ kind: 'stickerId', value: option.value })),
                            ...value('textTriggers').split('\n').map(word => word.trim()).filter(Boolean)
                            .map(word => ({ kind: 'text', value: word }))],
                        matchMode: value('matchMode'), priority: Number(value('priority')),
                        permanent: controls.permanent.checked, expiresAt: date('expiresAt'),
                        enabled: controls.enabled.checked && Boolean(value('meaning').trim())
                    });
                    const file = controls.image.files[0];
                    const asset = file ? await memoryZip.readImage(file) : null;
                    await memoryRepository.saveCode(characterId, copy ? undefined : existing?.id, record, asset, copy ? existing.id : undefined);
                } else {
                    const evAt = date('eventAt');
                    const impVal = Number(value('importance'));
                    const clarityChoice = value('clarityPreset');
                    const clarityPatch = {};
                    if (clarityChoice === 'clear') {
                        clarityPatch.baseStrength = 0.92;
                        clarityPatch.lastRecalledAt = Date.now();
                    } else if (clarityChoice === 'impression') {
                        clarityPatch.baseStrength = 0.45;
                        clarityPatch.lastRecalledAt = Date.now();
                    } else if (clarityChoice === 'fuzzy') {
                        clarityPatch.baseStrength = 0.18;
                        clarityPatch.lastRecalledAt = null;
                        clarityPatch.pinned = false;
                        clarityPatch.permanent = false;
                    }
                    Object.assign(record, { recallClass: value('recallClass'), summary: value('summary'), details: value('details'),
                        eventAt: evAt, importance: impVal, enabled: controls.enabled.checked, ...clarityPatch });
                    if (existing) await memoryRepository.update(characterId, existing.id, record);
                    else await memoryRepository.create(characterId, record);
                }
                editor.close();
                afterSave();
            } catch (error) {
                status.textContent = error.message;
            } finally {
                save.disabled = false;
            }
        });
        editor.addEventListener('close', () => editor.remove(), { once: true });
        const category = existing?.recallClass ?? initialClass;
        const heading = kind !== 'code' && category !== 'ordinary' ? recallClasses[category] : typeNames[kind];
        editor.append(element('h2', `${copy ? '复制' : existing ? '编辑' : '新建'}${heading}`),
            form, button('取消', () => editor.close()));
        document.body.append(editor);
        editor.showModal();
    }

    function close() {
        dispose?.();
        dispose = undefined;
    }

    function open(characterId, backTarget = 'chat-settings-screen') {
        const character = db.characters.find(item => item.id === characterId);
        if (!character) return;
        close();
        const screen = document.getElementById('memory-management-screen');
        const header = element('header', undefined, { className: 'app-header' });
        const title = element('div', undefined, { className: 'title-container' });
        title.append(element('h1', '长期记忆', { className: 'title' }));
        const back = element('button', '‹', { type: 'button', className: 'back-btn' });
        back.setAttribute('aria-label', '返回');
        back.addEventListener('click', () => switchScreen(backTarget));
        header.append(back, title, element('div', undefined, { className: 'placeholder' }));
        const body = element('main', undefined, { className: 'content' });
        const profile = element('div', undefined, { className: 'uwu-memory-profile kkt-group' });
        const name = character.remarkName || character.name || character.realName;
        const avatar = character.avatar || character.charAvatar;
        if (avatar) profile.append(element('img', undefined, { src: avatar, alt: '', className: 'kkt-profile-avatar' }));
        profile.append(element('strong', name, { className: 'kkt-profile-name' }));
        const tabs = element('nav', undefined, { className: 'settings-tabs' });
        tabs.setAttribute('aria-label', '长期记忆');
        const pane = element('section', undefined, { className: 'uwu-memory-pane' });
        const extras = element('nav', undefined, { className: 'uwu-memory-extra-tabs', hidden: true });
        extras.setAttribute('aria-label', '更多记忆功能');
        const status = element('p');
        status.setAttribute('role', 'status');
        const urls = [];
        const releaseImages = () => urls.splice(0).forEach(url => URL.revokeObjectURL(url));
        let selectedTab = '';
        let libraryCategory = 'all';
        let generation = 0;
        const isOpen = () => screen.classList.contains('active') && Boolean(dispose);
        const onError = error => { if (isOpen()) status.textContent = error.message; };

        async function lists(codes) {
            const version = ++generation;
            releaseImages();
            pane.replaceChildren();
            const allEntriesList = await memoryRepository.list(characterId);
            if (!isOpen() || generation !== version) return;
            const allEntriesById = new Map(allEntriesList.map(entry => [entry.id, entry]));
            const entries = allEntriesList.filter(entry => codes ? entry.kind === 'code' : entry.kind !== 'code');
            const assets = codes ? (await memoryRepository.getPackExport(characterId, entries.map(entry => entry.id))).assets : [];
            if (!isOpen() || generation !== version) return;
            const thumbnails = new Map();
            for (const asset of assets) {
                if (thumbnails.has(asset.entryId)) continue;
                const url = URL.createObjectURL(asset.blob);
                urls.push(url);
                thumbnails.set(asset.entryId, { url, fileName: asset.fileName });
            }

            // Overview bar (quick jump across memory types)
            const overview = element('div', undefined, { className: 'uwu-memory-overview' });
            const cntAll = allEntriesList.filter(e => e.kind !== 'code').length;
            const cntAgr = allEntriesList.filter(e => e.kind !== 'code' && e.recallClass === 'agreement').length;
            const cntEvo = allEntriesList.filter(e => e.kind !== 'code' && e.recallClass === 'evolution').length;
            const cntCode = allEntriesList.filter(e => e.kind === 'code').length;
            const makeStat = (num, label, onClick) => {
                const b = element('button', undefined, { type: 'button', className: 'uwu-memory-stat' });
                b.append(element('strong', String(num)), element('span', label));
                b.addEventListener('click', onClick);
                return b;
            };
            overview.append(
                makeStat(cntAll, '全部记忆', () => { libraryCategory = 'all'; openTab('library'); }),
                makeStat(cntAgr, '重要约定', () => { libraryCategory = 'agreement'; openTab('library'); }),
                makeStat(cntEvo, '成长变化', () => { libraryCategory = 'evolution'; openTab('library'); }),
                makeStat(cntCode, '暗号与梗', () => { openTab('codes'); })
            );

            const search = element('input', undefined, { type: 'search', placeholder: codes ? '搜索暗号名称、触发词、别名或含义…' : '搜索记忆标题、摘要或关键词…' });
            search.setAttribute('aria-label', '搜索记忆');
            const clarityFilter = select({ all: '清晰度：全部', '清晰': '仅看清晰', '有印象': '仅看有印象', '模糊': '仅看模糊' }, 'all');
            const sortSelect = select({ dateDesc: '排序：日期新→旧', dateAsc: '排序：日期旧→新', impDesc: '排序：重要度高→低' }, 'dateDesc');
            const types = select({ all: '类型：全部', event: typeNames.event, fact: typeNames.fact }, 'all');
            const archives = select({ current: '范围：当前存档可用', all: '范围：全部存档' }, 'current');
            const list = element('div');

            const categoryTabs = element('nav', undefined, { className: 'uwu-memory-categories' });
            categoryTabs.setAttribute('aria-label', '记忆分类');
            const guideBox = element('p', '', { className: 'uwu-memory-guide' });
            const actionBar = element('div', undefined, { className: 'uwu-memory-focus-bar' });
            const style = memoryEngine.styleFor(character);
            const clarityCls = { '清晰': 'uwu-badge-clear', '有印象': 'uwu-badge-impression', '模糊': 'uwu-badge-fuzzy' };

            let pageLimit = 30;
            const redraw = (resetPage = true) => {
                if (resetPage) pageLimit = 30;
                const needle = search.value.trim().toLowerCase();
                let visible = entries.filter(entry => {
                    if (!codes && libraryCategory !== 'all' && entry.recallClass !== libraryCategory) return false;
                    if (!codes && types.value !== 'all' && entry.kind !== types.value) return false;
                    if (archives.value !== 'all' && !memoryRepository.inArchive(entry, character.activeArchiveId)) return false;
                    if (!codes && clarityFilter.value !== 'all') {
                        const cLbl = memoryEngine.clarityLabel(memoryEngine.clarity(entry, Date.now(), style));
                        if (cLbl !== clarityFilter.value) return false;
                    }
                    if (!needle) return true;
                    const trigTexts = (entry.triggers || []).map(t => t.value);
                    return [entry.title, entry.summary, entry.details, entry.meaning, ...entry.keywords, ...(entry.aliases || []), ...trigTexts]
                        .some(value => value?.toLowerCase().includes(needle));
                });

                if (sortSelect.value === 'dateDesc') {
                    visible.sort((a, b) => (b.eventAt ?? b.updatedAt ?? 0) - (a.eventAt ?? a.updatedAt ?? 0));
                } else if (sortSelect.value === 'dateAsc') {
                    visible.sort((a, b) => (a.eventAt ?? a.updatedAt ?? 0) - (b.eventAt ?? b.updatedAt ?? 0));
                } else if (sortSelect.value === 'impDesc') {
                    visible.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
                }

                list.replaceChildren();
                const paged = visible.slice(0, pageLimit);
                for (const entry of paged) {
                    const card = element('article', undefined, { className: 'kkt-group uwu-memory-card' });
                    const match = thumbnails.get(entry.id);
                    const head = element('div', undefined, { className: 'uwu-memory-card-head' });
                    head.append(element('strong', entry.title, { className: 'uwu-memory-card-title' }));
                    if (match) head.append(element('img', undefined, { src: match.url, alt: match.fileName, width: 52, height: 52 }));
                    card.append(head);

                    const badges = element('div', undefined, { className: 'uwu-memory-badges' });
                    if (codes) {
                        badges.append(element('span', '暗号与梗', { className: 'uwu-badge uwu-badge-code' }));
                        badges.append(element('span', entry.enabled ? '已启用' : '已停用', { className: `uwu-badge ${entry.enabled ? 'uwu-badge-clear' : 'uwu-badge-fuzzy'}` }));
                    } else {
                        const cLbl = memoryEngine.clarityLabel(memoryEngine.clarity(entry, Date.now(), style));
                        badges.append(element('span', cLbl, { className: `uwu-badge ${clarityCls[cLbl] || 'uwu-badge-fuzzy'}` }));
                        if (entry.recallClass === 'agreement') badges.append(element('span', '重要约定', { className: 'uwu-badge uwu-badge-agreement' }));
                        else if (entry.recallClass === 'evolution') badges.append(element('span', '成长变化', { className: 'uwu-badge uwu-badge-evolution' }));
                        else if (entry.recallClass === 'core') badges.append(element('span', '核心设定', { className: 'uwu-badge uwu-badge-core' }));
                        else badges.append(element('span', typeNames[entry.kind], { className: 'uwu-badge uwu-badge-date' }));
                        if (entry.eventAt) {
                            const _d = new Date(entry.eventAt);
                            const _ds = (_d.getHours() === 0 && _d.getMinutes() === 0)
                                ? _d.toLocaleDateString()
                                : `${_d.toLocaleDateString()} ${String(_d.getHours()).padStart(2, '0')}:${String(_d.getMinutes()).padStart(2, '0')}`;
                            badges.append(element('span', _ds, { className: 'uwu-badge uwu-badge-date' }));
                        }
                        badges.append(element('span', `重要度 ${entry.importance}`, { className: 'uwu-badge uwu-badge-date' }));
                        if (!entry.enabled) badges.append(element('span', '已停用', { className: 'uwu-badge uwu-badge-fuzzy' }));
                    }
                    card.append(badges);

                    card.append(element('p', (codes ? entry.meaning : entry.summary || entry.details) || '待补充'));
                    if (codes) {
                        const trigWords = (entry.triggers || []).filter(t => t.kind === 'text').map(t => t.value);
                        if (trigWords.length) card.append(element('p', `触发词：${trigWords.join(' / ')}`, { className: 'uwu-memory-card-meta' }));
                        if (entry.aliases?.length) card.append(element('p', `别名：${entry.aliases.join('、')}`, { className: 'uwu-memory-card-meta' }));
                        if (entry.responseGuidance) card.append(element('p', `回应指引：${entry.responseGuidance}`, { className: 'uwu-memory-card-meta' }));
                    }

                    if (Array.isArray(entry.linkedEntryIds) && entry.linkedEntryIds.length) {
                        const chips = element('div', undefined, { className: 'uwu-memory-linked-chips' });
                        chips.append(element('span', '关联：', { style: 'font-size:.76rem;color:#666;' }));
                        for (const lid of entry.linkedEntryIds.slice(0, 6)) {
                            const target = allEntriesById.get(lid);
                            if (!target) continue;
                            const chip = element('button', target.title, { type: 'button', className: 'uwu-memory-linked-chip', title: '点击跳转编辑该关联记忆' });
                            chip.addEventListener('click', () => edit(character, target.kind, target, refresh));
                            chips.append(chip);
                        }
                        if (chips.children.length > 1) card.append(chips);
                    }

                    const footer = element('div', undefined, { className: 'uwu-memory-card-footer' });
                    footer.append(button('编辑', () => edit(character, entry.kind, entry, refresh)));
                    if (codes) {
                        footer.append(button('测试触发', () => {
                            const input = prompt('输入一条测试消息');
                            if (input !== null) status.textContent = memoryEngine.matchTextCode(entry, input)
                                ? '文字触发已命中' : '文字触发未命中';
                        }), button('复制', () => edit(character, entry.kind, entry, refresh, true)));
                        if (db.characters.length > 1) footer.append(button('复制到其他角色', () => shareCode(entry)));
                    }
                    footer.append(button(entry.enabled ? '停用' : '启用', async () => {
                        if (codes && !entry.enabled && !entry.meaning.trim()) {
                            status.textContent = '请先填写暗号含义';
                            return;
                        }
                        await memoryRepository.update(characterId, entry.id, { enabled: !entry.enabled }).then(refresh, onError);
                    }));
                    footer.append(button('删除', async () => {
                        if (confirm(`删除「${entry.title}」？此操作不可撤销。`)) {
                            await memoryRepository.delete(characterId, entry.id).then(refresh, onError);
                        }
                    }));
                    card.append(footer);
                    if (entry.sourceMessageIds?.length) card.append(sourceDetails(entry.sourceMessageIds, entry.archiveId));
                    list.append(card);
                }
                if (visible.length > paged.length) {
                    const moreBtn = element('button', `加载更多（还有 ${visible.length - paged.length} 条）`, { type: 'button', className: 'uwu-memory-load-more' });
                    moreBtn.addEventListener('click', () => { pageLimit += 30; redraw(false); });
                    list.append(moreBtn);
                }
                if (!visible.length) list.append(element('p', '当前条件下暂无条目，可使用上方按钮让 AI 提取或手动新增。'));
            };

            const openOrganize = (focusMode) => {
                const pending = memoryBatch.pending(character);
                if (pending) reviewBatch(pending);
                else selectBatchRange(focusMode);
            };

            const review = memoryBatch.pending(character);
            if (codes) {
                guideBox.textContent = '暗号与梗会在命中触发词或别名时优先发送给角色，让对方自然接梗或触发特定反应。可以直接让 AI 从聊天里专项提取，也可以手动新建。';
                const aiCodeBtn = button(review ? '审核待确认记忆' : 'AI 提取暗号与梗', () => openOrganize('code'));
                aiCodeBtn.className = 'btn btn-primary';
                const addCodeBtn = button('手动新建暗号', () => edit(character, 'code', null, refresh));
                actionBar.append(aiCodeBtn, addCodeBtn);
            } else {
                const categoryGuides = {
                    all: '记忆库整合了情景经历、稳定事实、核心设定、重要约定与成长变化。可以直接「综合整理聊天」，也可以点专项按钮单独提取约定、暗号或成长变化。',
                    core: categoryHelp.core,
                    agreement: '记录双方说好的承诺、计划、底线与相处规则。相关聊天触发时单独优先发送，不占普通记忆条数。',
                    evolution: categoryHelp.evolution
                };
                const pickCategory = key => {
                    libraryCategory = key;
                    for (const control of categoryTabs.children) {
                        control.setAttribute('aria-pressed', String(control.dataset.category === key));
                    }
                    guideBox.textContent = categoryGuides[key] || '';
                    actionBar.replaceChildren();
                    if (key === 'all') {
                        const mainOrg = button(review ? '审核待确认记忆' : '综合整理聊天', () => openOrganize('all'));
                        mainOrg.className = 'btn btn-primary';
                        const focusMenu = element('details', undefined, { className: 'uwu-memory-focus-menu' });
                        const focusDrop = element('div');
                        focusDrop.append(
                            button('提取：重要约定', () => { focusMenu.open = false; openOrganize('agreement'); }),
                            button('提取：暗号与梗', () => { focusMenu.open = false; openOrganize('code'); }),
                            button('提取：成长变化', () => { focusMenu.open = false; openOrganize('evolution'); }),
                            button('提取：核心设定', () => { focusMenu.open = false; openOrganize('core'); })
                        );
                        focusMenu.append(element('summary', '专项提取 ▾'), focusDrop);
                        actionBar.append(
                            mainOrg,
                            focusMenu,
                            button('手动新增', () => edit(character, 'event', null, refresh))
                        );
                    } else {
                        const aiBtn = button(review ? '审核待确认记忆' : `AI 提取${recallClasses[key]}`, () => openOrganize(key));
                        aiBtn.className = 'btn btn-primary';
                        const addBtn = button(`手动新增${recallClasses[key]}`, () =>
                            edit(character, (key === 'core' || key === 'evolution') ? 'fact' : 'event', null, refresh, false, key));
                        actionBar.append(aiBtn, addBtn);
                    }
                };
                for (const [key, label] of Object.entries(libraryCategories)) {
                    const control = button(label, () => { pickCategory(key); redraw(); });
                    control.dataset.category = key;
                    categoryTabs.append(control);
                }
                pickCategory(libraryCategory);
            }

            search.addEventListener('input', redraw);
            clarityFilter.addEventListener('change', redraw);
            sortSelect.addEventListener('change', redraw);
            types.addEventListener('change', redraw);
            archives.addEventListener('change', redraw);

            const toolbar = element('div', undefined, { className: 'uwu-memory-toolbar' });
            if (!codes) toolbar.append(clarityFilter, sortSelect, types, archives);
            else toolbar.append(archives);

            pane.append(overview);
            if (!codes) pane.append(categoryTabs);
            pane.append(guideBox, actionBar, search, toolbar, list);
            redraw();
        }

        function selectBatchRange(initialFocus = 'all') {
            const panel = element('dialog', undefined, { className: 'uwu-memory-dialog' });
            const history = character.history || [];
            const focusSelect = select({
                all: '综合整理（经历、事实、约定、成长变化、暗号）',
                agreement: '专项提取：重要约定与承诺',
                code: '专项提取：暗号、昵称开关与专属梗',
                evolution: '专项提取：角色成长与动态变化',
                core: '专项提取：核心设定与长期事实'
            }, initialFocus);
            const focusHints = {
                all: '一次从所选聊天中全面提取值得长期记住的经历、事实、重要约定、成长变化与专属暗号。',
                agreement: '只重点挖掘双方说好的约定、计划、规则与底线，直接归类为「重要约定」。',
                code: '只重点挖掘专属暗号、特殊称呼开关、固定玩梗与回应默契，自动生成触发词与回应指引。',
                evolution: '只重点挖掘语言/打字习惯进步、工作薪资变动、生活状态与相处方式演进，归类为「成长变化」。',
                core: '只重点提炼身份背景、健康用药、长期原则等核心设定。'
            };
            const focusHintEl = element('p', focusHints[initialFocus] || focusHints.all, { className: 'uwu-memory-guide' });
            focusSelect.addEventListener('change', () => { focusHintEl.textContent = focusHints[focusSelect.value] || ''; });

            const mode = select({ continuation: '接着上次整理', custom: '指定起止消息' }, 'continuation');
            const fields = element('div');
            const current = memoryBatch.selectMessages(character);
            const start = element('input', undefined, { type: 'number', min: 1, max: history.length, step: 1,
                value: current.messages[0]?.number ?? (history.length || '') });
            const end = element('input', undefined, { type: 'number', min: 1, max: history.length, step: 1,
                value: current.messages.at(-1)?.number ?? (history.length || '') });
            const advance = element('input', undefined, { type: 'checkbox' });
            const advanceControl = field('从这段结束处继续（跳过前面的未整理消息）', advance);
            fields.append(field('起始消息编号', start), field('结束消息编号', end), advanceControl);
            const preview = element('div');
            const references = memoryReferencePicker.create(characterId, getActiveArchive(character).id);
            const progress = element('p');
            progress.setAttribute('role', 'status');
            let busy = false;
            let approvedMessages = '';
            const signature = messages => JSON.stringify(messages.map(({ id, text, speaker }) => [id, text, speaker]));
            const range = () => mode.value === 'custom'
                ? { start: start.valueAsNumber, end: end.valueAsNumber, advancePastGap: advance.checked } : undefined;
            const send = button('开始整理', async () => {
                if (busy) return;
                const fresh = updatePreview();
                if (!fresh || !fresh.stable) {
                    if (fresh) progress.textContent = '聊天内容已变动，请核对新范围后再次发送。';
                    return;
                }
                if (!references.ready()) {
                    progress.textContent = '请核对已有记忆的发送方式和范围后重试。';
                    return;
                }
                busy = true;
                send.disabled = mode.disabled = focusSelect.disabled = start.disabled = end.disabled = advance.disabled = true;
                references.setBusy(true);
                progress.textContent = '正在调用 AI 整理所选文本…';
                try {
                    const result = await memoryBatch.generate(character, undefined, false, range(), references.selected(), focusSelect.value);
                    if (!panel.open || !isOpen()) return;
                    panel.close();
                    if (result?.candidates.length) reviewBatch(result);
                    else status.textContent = result ? `这批聊天未提取到新条目（模型返回：${String(result.rawPreview || '[]').slice(0, 80)}）` : '没有待整理的文本，或整理已在进行';
                } catch (error) {
                    progress.textContent = error.message;
                } finally {
                    busy = false;
                    references.setBusy(false);
                    send.disabled = mode.disabled = focusSelect.disabled = start.disabled = end.disabled = advance.disabled = false;
                }
            });

            function describe(number) {
                const message = character.history?.[number - 1];
                if (!message) return '';
                const excerpt = memoryBatch.messageText(message);
                return `第 ${number} 条 · ${excerpt ? excerpt.slice(0, 80) : '此条没有可发送的文本'}`;
            }

            function updatePreview() {
                fields.hidden = !range();
                preview.replaceChildren();
                progress.textContent = '';
                try {
                    const custom = range();
                    const { messages, shouldAdvance, hasGap } = memoryBatch.selectMessages(character, custom);
                    references.updateMessages(messages);
                    advanceControl.hidden = !hasGap;
                    if (!hasGap) advance.checked = false;
                    const first = messages[0]?.number;
                    const last = messages.at(-1)?.number;
                    if (first === undefined) {
                        preview.append(element('p', '这个范围内没有可整理的聊天文本。'));
                    } else {
                        preview.append(element('p', `本次将发送第 ${first} 至 ${last} 条消息中的 ${messages.length} 条文本。`),
                            element('p', describe(custom?.start ?? first)));
                        if ((custom?.end ?? last) !== (custom?.start ?? first)) {
                            preview.append(element('p', describe(custom?.end ?? last)));
                        }
                        const sample = element('details', undefined, { className: 'uwu-memory-range-sample' });
                        sample.append(element('summary', '查看将发送的文本'));
                        for (const message of messages) {
                            sample.append(element('p', `第 ${message.number} 条 · ${message.speaker}：${message.text}`));
                        }
                        preview.append(sample);
                        if (!shouldAdvance) preview.append(element('p', '这段整理完成后不会改变「接着上次整理」的起点。'));
                    }
                    const nextSignature = signature(messages);
                    const stable = nextSignature === approvedMessages;
                    approvedMessages = nextSignature;
                    send.disabled = !messages.length;
                    return { stable };
                } catch (error) {
                    approvedMessages = '';
                    send.disabled = true;
                    preview.append(element('p', error.message));
                    return null;
                }
            }

            send.className = 'btn btn-primary';
            for (const control of [mode, start, end, advance]) control.addEventListener('change', updatePreview);
            for (const control of [start, end]) control.addEventListener('input', updatePreview);
            panel.append(element('h2', 'AI 整理聊天记录'), field('整理目标', focusSelect), focusHintEl,
                field('整理范围', mode), fields, preview, references.element, send, progress,
                button('取消', () => panel.close()));
            panel.addEventListener('close', () => panel.remove(), { once: true });
            updatePreview();
            document.body.append(panel);
            panel.showModal();
        }

        function shareCode(entry) {
            const panel = element('dialog', undefined, { className: 'uwu-memory-dialog' });
            const roles = element('select');
            roles.add(element('option', '请选择目标角色', { value: '' }));
            for (const role of db.characters.filter(role => role.id !== characterId)) {
                roles.add(element('option', role.remarkName || role.name || role.realName || role.id, { value: role.id }));
            }
            const result = element('p');
            result.setAttribute('role', 'status');
            const copy = button('确认复制暗号和图片', async () => {
                copy.disabled = roles.disabled = true;
                try {
                    await memoryRepository.shareCode(characterId, roles.value, entry.id);
                    panel.close();
                    status.textContent = '暗号已复制到所选角色';
                } catch (error) {
                    result.textContent = error.message;
                    copy.disabled = roles.disabled = false;
                }
            });
            copy.disabled = true;
            roles.addEventListener('change', () => { copy.disabled = !roles.value; });
            panel.append(element('h2', '复制暗号到其他角色'), element('p', entry.title),
                element('p', '目标角色会得到独立副本，包含暗号定义和图片。'),
                field('目标角色', roles), copy, result, button('取消', () => panel.close()));
            panel.addEventListener('close', () => panel.remove(), { once: true });
            document.body.append(panel);
            panel.showModal();
        }

        function sourceDetails(ids, archiveId) {
            const details = element('details');
            const summary = element('summary', `查看来源消息（${ids.length}）`);
            details.append(summary);
            details.addEventListener('toggle', () => {
                if (!details.open || details.childElementCount > 1) return;
                const sources = new Map();
                const needed = new Set(ids);
                const histories = [!archiveId || archiveId === character.activeArchiveId ? character.history || [] : [],
                    ...(character.archives || []).filter(archive => archive.id !== character.activeArchiveId
                        && (!archiveId || archive.id === archiveId)).map(archive => archive.data?.history || [])];
                for (const history of histories) {
                    for (const message of history) {
                        if (needed.delete(message.id)) sources.set(message.id, message);
                    }
                    if (!needed.size) break;
                }
                for (const id of ids) {
                    const message = sources.get(id);
                    const text = memoryBatch.messageText(message);
                    const speaker = message?.role === 'assistant' ? '角色' : '用户';
                    details.append(element('p', text ? `${speaker}：${text}` : `来源消息 ${id} 已删除、隐藏或不可用`));
                }
            });
            return details;
        }

        function reviewBatch(review) {
            const panel = element('dialog', undefined, { className: 'uwu-memory-dialog' });
            const reviewStatus = element('p');
            const fields = [];
            panel.append(element('h2', `审核候选记忆（共 ${review.candidates.length} 条）`));
            for (const item of review.candidates) {
                const isCode = item.kind === 'code';
                const box = element('input', undefined, { type: 'checkbox', checked: true });
                const title = element('input', undefined, { value: item.title || '', maxLength: 100 });
                const summary = element('textarea', undefined, { value: isCode ? (item.meaning || item.summary || '') : (item.summary || ''), maxLength: 450, rows: 3 });
                const replaceSummary = element('input', undefined, { type: 'checkbox' });
                const scope = select({ current: '仅当前存档', shared: '角色通用' }, isCode ? 'shared' : 'current');
                const recallClass = select({ '': '按原类别', ...recallClasses }, item.recallClass || '');
                const section = element('fieldset', undefined, { className: 'uwu-memory-review-item' });
                let textTriggers = null, aliases = null, responseGuidance = null;
                if (isCode) {
                    const trigStr = (item.triggers || []).filter(t => t.kind === 'text').map(t => t.value).join('\n');
                    textTriggers = element('textarea', undefined, { value: trigStr, rows: 2 });
                    aliases = element('input', undefined, { value: (item.aliases || []).join('，') });
                    responseGuidance = element('textarea', undefined, { value: item.responseGuidance || '', rows: 2 });
                    section.append(element('legend', '暗号与梗'), field('保存此条', box),
                        field('暗号名称', title), field('约定含义', summary),
                        field('触发词（每行一条）', textTriggers), field('别名（逗号分隔）', aliases),
                        field('角色回应指引', responseGuidance), field('记忆范围', scope),
                        sourceDetails(item.sourceMessageIds, item.archiveId || character.activeArchiveId));
                } else {
                    section.append(element('legend', typeNames[item.kind] || '记忆'), field('保存此条', box),
                        field('标题', title), field('摘要', summary), field('记忆范围', scope), field('记忆分类', recallClass),
                        field('同名记忆存在时更新摘要', replaceSummary), sourceDetails(item.sourceMessageIds, item.archiveId || character.activeArchiveId));
                }
                fields.push({ box, title, summary, replaceSummary, scope, recallClass, isCode, textTriggers, aliases, responseGuidance });
                panel.append(section);
            }
            const save = button('保存选中的记忆', async () => {
                const selected = fields.flatMap(({ box }, index) => box.checked ? [index] : []);
                if (!selected.length && !confirm('跳过这批候选记忆？')) return;
                save.disabled = true;
                try {
                    const changes = Object.fromEntries(selected.map(index => {
                        const f = fields[index];
                        if (f.isCode) {
                            return [index, {
                                title: f.title.value,
                                meaning: f.summary.value,
                                summary: f.summary.value,
                                responseGuidance: f.responseGuidance.value,
                                triggers: f.textTriggers.value.split('\n').map(w => w.trim()).filter(Boolean).map(value => ({ kind: 'text', value })),
                                aliases: split(f.aliases.value),
                                shared: f.scope.value === 'shared'
                            }];
                        }
                        return [index, { title: f.title.value, summary: f.summary.value, replaceSummary: f.replaceSummary.checked,
                            shared: f.scope.value === 'shared', recallClass: f.recallClass.value || undefined }];
                    }));
                    const result = await memoryBatch.confirm(character, review, selected, changes);
                    panel.close();
                    await refresh();
                    if (isOpen()) status.textContent = `新增 ${result.created} 条，合并 ${result.merged} 条`;
                } catch (error) {
                    reviewStatus.textContent = error.message;
                } finally {
                    save.disabled = false;
                }
            });
            panel.append(save, reviewStatus, button('稍后审核', () => { panel.close(); refresh(); }));
            panel.addEventListener('close', () => panel.remove(), { once: true });
            document.body.append(panel);
            panel.showModal();
        }

        function transfer() {
            const importJson = element('input', undefined, { type: 'file', accept: '.json,application/json' });
            const strategies = { skip: '跳过重复条目', merge: '合并已有条目', replace: '覆盖整个记忆库' };
            const strategy = select(strategies, 'skip');
            importJson.addEventListener('change', async () => {
                const file = importJson.files[0];
                if (!file) return;
                try {
                    const backup = JSON.parse(await file.text());
                    if (backup?.format !== 'uwu-character-memory' || typeof backup.characterId !== 'string') {
                        throw new Error('请选择角色长期记忆备份');
                    }
                    const remap = backup.characterId !== characterId;
                    const name = character.remarkName || character.name;
                    const chosen = strategy.value;
                    const source = remap ? `备份角色 ${backup.characterId}` : '当前角色备份';
                    if (!confirm(`将「${source}」恢复到「${name}」，采用「${strategies[chosen]}」？`)) return;
                    const result = await memoryRepository.restoreBackup(characterId, backup, { remap, strategy: chosen });
                    status.textContent = chosen === 'replace' ? `角色记忆已恢复，现有 ${result.entries} 条`
                        : `已新增 ${result.added} 条，合并 ${result.merged} 条，跳过 ${result.skipped} 条`;
                } catch (error) {
                    onError(error);
                } finally {
                    importJson.value = '';
                }
            });
            pane.replaceChildren(button('暗号 ZIP 导入与导出', () => memoryZipUi.open(characterId)),
                button('导出角色记忆备份', async () => {
                    try {
                        const backup = await memoryRepository.exportBackup(characterId);
                        download(new Blob([JSON.stringify(backup)], { type: 'application/json' }), 'UwU-角色记忆.json');
                    } catch (error) { onError(error); }
                }),
                button('一键导出纯聊天记录（TXT 阅读版）', () => {
                    try {
                        const hist = character.history || [];
                        const uName = character.myName || '我';
                        const cName = character.realName || character.remarkName || character.name || '角色';
                        const fmt = ts => {
                            if (!ts) return '';
                            const d = new Date(ts);
                            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                        };
                        const lines = hist.map(m => {
                            const txt = memoryBatch.messageText(m).replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
                            if (!txt) return '';
                            const who = m.role === 'user' ? uName : cName;
                            return `[${fmt(m.timestamp)}] ${who}：${txt}`;
                        }).filter(Boolean);
                        const today = new Date().toISOString().slice(0, 10);
                        download(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${cName}-聊天记录-${today}.txt`);
                        status.textContent = `已导出 ${lines.length} 条纯文本聊天记录`;
                    } catch (error) { onError(error); }
                }),
                button('一键导出纯聊天记录（JSON 备份版）', () => {
                    try {
                        const hist = character.history || [];
                        const cName = character.realName || character.remarkName || character.name || '角色';
                        const today = new Date().toISOString().slice(0, 10);
                        const payload = { format: 'uwu-chat-history-backup', exportedAt: new Date().toISOString(), characterName: cName, count: hist.length, history: hist };
                        download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${cName}-聊天备份-${today}.json`);
                        status.textContent = `已导出 ${hist.length} 条 JSON 聊天备份`;
                    } catch (error) { onError(error); }
                }), field('备份重复项处理', strategy), field('恢复角色记忆备份', importJson),
                button('一键将本角色全部记忆设为「角色通用（所有存档）」', async () => {
                    const allMem = await memoryRepository.list(characterId);
                    if (!allMem.length) { status.textContent = '当前角色暂无记忆可切换'; return; }
                    if (!confirm(`确认将「${character.remarkName || character.name}」的全部 ${allMem.length} 条记忆都设为「角色通用（所有存档适用）」吗？`)) return;
                    try {
                        await dexieDB.memoryEntries.where('characterId').equals(characterId).modify({ archiveId: null, updatedAt: Date.now() });
                        status.textContent = `已将全部 ${allMem.length} 条记忆切换为「所有存档通用」`;
                    } catch (error) { onError(error); }
                }),
                button('一键将本角色全部记忆设为「仅当前存档」', async () => {
                    const allMem = await memoryRepository.list(characterId);
                    if (!allMem.length) { status.textContent = '当前角色暂无记忆可切换'; return; }
                    const activeArc = getActiveArchive(character);
                    if (!confirm(`确认将「${character.remarkName || character.name}」的全部 ${allMem.length} 条记忆都设为仅「${activeArc.name}」存档适用吗？`)) return;
                    try {
                        await dexieDB.memoryEntries.where('characterId').equals(characterId).modify({ archiveId: activeArc.id, updatedAt: Date.now() });
                        status.textContent = `已将全部 ${allMem.length} 条记忆切换为仅「${activeArc.name}」适用`;
                    } catch (error) { onError(error); }
                }),
                button('清空已保存的长期记忆', async () => {
                    if (!confirm(`清空「${character.remarkName || character.name}」已保存的记忆、暗号和图片？`)) return;
                    try {
                        await memoryRepository.clearSavedMemories(characterId);
                        status.textContent = '已保存的长期记忆已清空';
                    } catch (error) { onError(error); }
                }));
        }

        function settings(keepAdvancedOpen = false) {
            const config = settingsFor(character);
            const form = element('form');
            const controls = {};
            const advanced = element('details', undefined, { className: 'uwu-memory-advanced', open: keepAdvancedOpen });
            advanced.append(element('summary', '高级设置'),
                element('p', '日常使用可以保留默认值。', { className: 'uwu-memory-setting-help' }));
            const use = element('section', undefined, { className: 'uwu-memory-setting-section' });
            const organize = element('section', undefined, { className: 'uwu-memory-setting-section' });
            const inspect = element('section', undefined, { className: 'uwu-memory-setting-section' });
            use.append(element('h3', '聊天时怎么用记忆'));
            organize.append(element('h3', '每次怎么整理聊天'));
            inspect.append(element('h3', '查看发送记录'));
            advanced.append(use, organize, inspect);

            function setting(parent, key, label, control, description) {
                const row = element('div', undefined, { className: 'uwu-memory-setting' });
                const caption = field(label, control);
                const help = element('p', description, { id: `uwu-memory-help-${key}`, className: 'uwu-memory-setting-help' });
                controls[key].setAttribute('aria-describedby', help.id);
                row.append(caption, help);
                parent.append(row);
                return row;
            }

            function toggle(parent, key, label, description) {
                controls[key] = element('input', undefined, { type: 'checkbox', checked: config[key] });
                const wrapper = element('span', undefined, { className: 'kkt-switch' });
                const slider = element('span', undefined, { className: 'kkt-slider' });
                slider.setAttribute('aria-hidden', 'true');
                wrapper.append(controls[key], slider);
                setting(parent, key, label, wrapper, description);
            }

            function number(parent, key, label, min, max, description) {
                const attrs = { type: 'number', value: config[key], step: 1, required: true };
                if (min !== null && min !== undefined) attrs.min = min;
                if (max !== null && max !== undefined) attrs.max = max;
                controls[key] = element('input', undefined, attrs);
                setting(parent, key, label, controls[key], description);
            }

            toggle(form, 'enabled', '启用长期记忆', '聊天时会找出相关记忆，帮助角色接上以前的事。');
            toggle(form, 'autoOrganize', '自动整理聊天', '积累够一批新消息后，AI 会提议可保存的记忆，等你确认。');
            const help = element('p', '告诉 AI 这个角色平时会记住什么，以及记得多详细。留空时按角色人设和高级设置里的清晰度整理。', { id: 'uwu-organize-style-help' });
            controls.organizeStylePrompt = element('textarea', undefined, { rows: 4, maxLength: memoryBatch.stylePromptLimit,
                value: memoryBatch.cleanStylePrompt(config.organizeStylePrompt),
                placeholder: '例如：{{char}} 有点迷糊，会记住答应过的事和当时的感受，想不起琐碎的数字。' });
            controls.organizeStylePrompt.setAttribute('aria-describedby', help.id);
            const promptRow = field('整理提示词', controls.organizeStylePrompt);
            promptRow.className = 'uwu-memory-style-prompt';
            form.append(promptRow, help, advanced);
            number(use, 'maxEntries', '每轮最多发送几条记忆', 0, null,
                '控制每轮最多发送几条普通记忆（填 0 不限条数，填任意正整数即按该数量发送）。命中的重要约定、核心设定、成长变化和暗号单独发送。');
            number(use, 'tokenBudget', '记忆 Token 上限', 0, null,
                '控制发给 AI 的记忆文字量。填 0 完全不限长度，也可填任意正整数（不设上限）。');
            advanced.addEventListener('invalid', () => { advanced.open = true; }, true);
            number(use, 'recentWindow', '找记忆时参考几条近期消息', 1, null,
                '用最近几条你发过的消息当线索（不设上限，填多少就参考多少条）。');
            controls.recallStyle = select({ auto: '跟随角色设定', balanced: '均衡',
                fuzzy: '偏模糊', sharp: '偏清晰' }, config.recallStyle);
            const clarity = setting(use, 'recallStyle', '回忆的清晰度', controls.recallStyle,
                '旧经历会随时间变模糊。「偏清晰」保留更多细节，「偏模糊」更容易只记得大意。');
            const styleNote = element('p', undefined, { className: 'uwu-memory-setting-help' });
            const showStyle = () => {
                styleNote.textContent = `当前倾向 · ${memoryEngine.styleFor(character, controls.recallStyle.value).label}`;
            };
            controls.recallStyle.addEventListener('change', showStyle);
            showStyle();
            clarity.append(styleNote);
            toggle(use, 'preferCodes', '优先使用暗号', '同一轮同时找到暗号和普通记忆时，优先把暗号发给 AI。');
            toggle(use, 'localVectors', '也查找用词相近的记忆', '没命中关键词时，也在本机按相近用词找一遍。');
            toggle(use, 'similarImages', '相似图片也能触发暗号', '在本机比对图片。图片缩放或换了格式，仍有机会触发暗号。');
            toggle(use, 'callMemory', '通话时也使用长期记忆', '开启后，语音和视频通话也可以用这个角色的记忆。');
            toggle(use, 'legacyJournalInjection', '聊天时也发送收藏的日记', '同时把收藏的日记发给聊天模型，可能增加请求长度。');
            number(organize, 'batchSize', '每次整理几条聊天消息', 1, null,
                '自动整理要等新消息达到这个数量，手动点「接着上次整理」也用这个数量（不设上限，填多少就整理多少条）。');
            number(organize, 'autoIntervalMinutes', '自动整理间隔（分钟）', 0, null,
                '两次自动整理请求至少要隔多久（填 0 不限间隔，可填任意非负整数）。手动整理随时可以发起。');
            number(organize, 'batchMaxCandidates', '每次最多提议几条记忆', 1, null,
                '控制 AI 单次最多提议几条待确认记忆（不设上限，填多少就是多少）。');
            toggle(inspect, 'debug', '显示记忆调试信息', '开启后再发一条消息，就能在本页看哪些记忆被发送、哪些被跳过。');
            const save = element('button', '保存设置（仅当前角色）', { type: 'submit', className: 'btn btn-primary' });
            const applyAllBtn = button('将此记忆设置应用到全部角色', async () => {
                if (!confirm(`确认将当前的记忆通用设置（不含各自专属整理提示词）应用到全部 ${db.characters.length} 位角色吗？`)) return;
                applyAllBtn.disabled = true;
                try {
                    const sharedConfig = Object.fromEntries(Object.entries(controls)
                        .filter(([key]) => key !== 'organizeStylePrompt')
                        .map(([key, control]) => [key, control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value]));
                    const ownPrompt = memoryBatch.cleanStylePrompt(controls.organizeStylePrompt.value);
                    for (const ch of db.characters) {
                        ch.memorySettings = { ...(ch.memorySettings || {}), ...sharedConfig };
                        if (ch.id === character.id) ch.memorySettings.organizeStylePrompt = ownPrompt;
                    }
                    await saveData();
                    status.textContent = `已将记忆设置应用到全部 ${db.characters.length} 位角色`;
                } catch (error) {
                    onError(error);
                } finally {
                    applyAllBtn.disabled = false;
                }
            });
            applyAllBtn.style.marginTop = '8px';
            form.append(save, applyAllBtn);
            form.addEventListener('submit', async event => {
                event.preventDefault();
                save.disabled = true;
                const before = character.memorySettings;
                character.memorySettings = { ...before, ...Object.fromEntries(Object.entries(controls).map(([key, control]) =>
                    [key, control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value])),
                    organizeStylePrompt: memoryBatch.cleanStylePrompt(controls.organizeStylePrompt.value) };
                try {
                    await saveData();
                    if (config.debug !== character.memorySettings.debug) settings(advanced.open);
                    status.textContent = '设置已保存';
                } catch (error) {
                    character.memorySettings = before;
                    onError(error);
                } finally {
                    save.disabled = false;
                }
            });
            pane.replaceChildren(form);
            if (config.debug) {
                const report = element('section', undefined, { className: 'kkt-group uwu-memory-card' });
                report.append(element('h3', '最近一次请求的长期记忆'));
                const recent = memoryPrompt.stats(characterId);
                if (!recent?.decisions) {
                    report.append(element('p', '当前存档暂无请求记录。发送一条私聊消息后可在这里查看。'));
                } else {
                    const { systemTokens, memoryTokens, historyTokens, matches, used, ordinaryUsed, usage, decisions, budget, max } = recent;
                    report.append(
                        element('p', `命中 ${matches} 条 · 普通记忆发送 ${ordinaryUsed} / ${max} 条 · 单独计算 ${used - ordinaryUsed} 条`),
                        element('p', `估算 Token · 记忆 ${memoryTokens} / ${budget === 0 ? '不限' : budget} · 系统 ${systemTokens} · 历史 ${historyTokens}`)
                    );
                    if (usage) report.append(element('p', `接口用量 · 输入 ${usage.input ?? '未返回'} · 输出 ${usage.output ?? '未返回'}`));
                    if (!matches) report.append(element('p', '这轮没有命中长期记忆。'));
                    for (const decision of decisions) {
                        const detail = element('details', undefined, { className: 'uwu-memory-decision' });
                        detail.append(element('summary', `${decision.title} · ${decision.status}`));
                        if (decision.reasons.length) detail.append(element('p', `命中依据 · ${decision.reasons.join('、')}`));
                        if (decision.snippet) detail.append(element('p', decision.snippet));
                        report.append(detail);
                    }
                }
                pane.append(report);
            }
        }

        function refresh() {
            status.textContent = '';
            if (selectedTab === 'library' || selectedTab === 'codes') return lists(selectedTab === 'codes').catch(onError);
            generation++;
            releaseImages();
            if (selectedTab === 'transfer') transfer();
            else if (selectedTab === 'timeline') memoryViews.timeline(pane, character, () => generation, entry => edit(character, entry.kind, entry, refresh)).catch(onError);
            else if (selectedTab === 'relations') memoryViews.relations(pane, character, () => generation, entry => edit(character, entry.kind, entry, refresh)).catch(onError);
            else settings();
        }
        const primaryTabs = { library: '记忆库', codes: '暗号与梗', timeline: '时间线', relations: '关系图', transfer: '备份', settings: '设置' };
        const controls = new Map();
        extras.hidden = true;
        function openTab(key) {
            selectedTab = Object.hasOwn(primaryTabs, key) ? key : 'library';
            for (const [name, control] of controls) {
                const active = name === selectedTab;
                control.setAttribute('aria-pressed', String(active));
                control.classList.toggle('active', active);
            }
            refresh();
        }
        for (const [key, label] of Object.entries(primaryTabs)) {
            const control = button(label, () => openTab(key));
            control.className = 'settings-tab-item';
            controls.set(key, control);
            tabs.append(control);
        }
        dispose = () => {
            generation++;
            releaseImages();
            screen.replaceChildren();
        };
        body.append(profile, tabs, extras, pane, status);
        screen.replaceChildren(header, body);
        switchScreen('memory-management-screen');
        tabs.firstElementChild.click();
    }

    return { open, close, settingsFor };
})();
;
const memoryPrompt = (() => {
    const lastRun = new Map();
    const opening = '\n\n<长期记忆>\n以下是你脑海里自然浮现的真实回忆，请把它们当成你亲身经历过的记忆去消化，绝不要像念档案或复述提示词一样照搬：\n- 自然流露：只在话题顺路时顺口带出、调侃、关心或翻旧账，别生硬地报年月日或背诵整段摘要。\n- 清晰与模糊的真实感：标记[清晰]的记得细节与当时心情；标记[模糊]的只剩大概印象，被问到细节时像真人一样自然说记不太清或好像有这回事，绝不硬编。\n- 暗号与梗：命中[暗号]时立刻心领神会，按你们的默契自然接招，不要像解释词典一样拆穿它。\n- 动态成长：人设与习惯会随时间演变，遇到[成长变化]（如语言/打字习惯、工作收入、相处方式）时，无声地以最新状态替代旧习惯，直接体现在你的说话方式与当下状态里。\n';
    const closing = '\n</长期记忆>\n';
    const clean = (value, limit) => String(value ?? '').slice(0, limit)
        .replace(/data:[^\s\]\)]+/gi, '[图片已略]')
        .replaceAll('【动态插入: 聊天记录】', '')
        .replace(/[<>]/g, char => char === '<' ? '＜' : '＞')
        .replace(/\s+/g, ' ').trim();

    function fit(text, maximum) {
        if (countTextTokens(text) <= maximum) return text;
        const chars = Array.from(text);
        let low = 0;
        let high = chars.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (countTextTokens(chars.slice(0, mid).join('') + '…') <= maximum) low = mid;
            else high = mid - 1;
        }
        return low > 0 ? chars.slice(0, low).join('').trimEnd() + '…' : '';
    }

    function build(results, settings) {
        const rawMax = Number(settings.maxEntries);
        const max = (Number.isFinite(rawMax) && rawMax === 0) ? Infinity : Math.max(1, Math.trunc(Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 3));
        const rawBudget = Number(settings.tokenBudget);
        const unlimited = settings.tokenBudget === 0 || (typeof settings.tokenBudget === 'string' && settings.tokenBudget.trim() === '0') || (Number.isFinite(rawBudget) && rawBudget <= 0);
        const budget = unlimited ? 0 : Math.max(1, Math.trunc(Number.isFinite(rawBudget) ? rawBudget : 300));
        const cleanField = value => clean(value, Infinity);
        const lines = [];
        const used = [];
        let ordinaryUsed = 0;
        const decisions = [];
        function report(hit, status, snippet) {
            if (!settings.debug) return;
            decisions.push({ title: hit.entry.title, status, reasons: hit.reasons || [], snippet });
        }
        const orderedResults = unlimited ? results : [
            ...results.filter(h => h.entry.kind === 'code'),
            ...results.filter(h => h.entry.kind !== 'code' && h.entry.recallClass !== 'evolution').slice(0, 2),
            ...results.filter(h => h.entry.recallClass === 'evolution'),
            ...results.filter(h => h.entry.kind !== 'code' && h.entry.recallClass !== 'evolution').slice(2)
        ];
        for (const hit of orderedResults) {
            const entry = hit.entry;
            const classification = entry.kind === 'code' ? '暗号'
                : entry.recallClass === 'evolution' ? '成长变化'
                : entry.recallClass === 'agreement' ? '重要约定' : entry.recallClass === 'core' ? '核心设定' : '';
            if (!classification && ordinaryUsed >= max) {
                report(hit, '条数上限');
                continue;
            }
            const fmtPromptTime = ts => {
                if (!ts) return '';
                const d = new Date(ts);
                const base = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                return (d.getHours() === 0 && d.getMinutes() === 0)
                    ? base
                    : `${base} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            };
            const timeStampTag = entry.eventAt ? ` ${fmtPromptTime(entry.eventAt)}` : '';
            const type = (classification ? classification + (entry.recallClass === 'evolution' ? timeStampTag : '') : '') || ((entry.kind === 'fact' ? '事实' : memoryEngine.clarityLabel(hit.clarity)) + (entry.kind === 'event' ? timeStampTag : ''));
            const title = cleanField(entry.title);
            const prefix = `- [${type}] ${title}：`;
            const summary = cleanField(entry.summary);
            const details = cleanField(entry.details);
            const body = entry.kind === 'code' ? [cleanField(entry.meaning), cleanField(entry.responseGuidance)].filter(Boolean).join('；回应：')
                : [summary, hit.clarity >= 0.6 ? details : ''].filter(Boolean).join('；');
            if (!body && !entry.title) continue;
            const remaining = unlimited ? Infinity
                : budget - countTextTokens(opening + lines.join('\n') + '\n' + prefix + closing) - 1;
            if (remaining < 6) {
                report(hit, 'Token 预算不足');
                continue;
            }
            const text = body || '仅记得这个线索';
            const excerpt = unlimited ? text : fit(text, remaining);
            if (!excerpt) {
                report(hit, 'Token 预算不足');
                continue;
            }
            report(hit, '已发送', prefix + excerpt);
            lines.push(prefix + excerpt);
            used.push(hit);
            if (!classification) ordinaryUsed++;
        }
        const text = lines.length ? opening + lines.join('\n') + closing : '';
        return { text, used, ordinaryUsed, tokens: countTextTokens(text), decisions, budget, max };
    }

    async function prepare(character, history, systemPrompt) {
        const settings = memoryManagement.settingsFor(character);
        if (!settings.enabled) return null;
        const archiveId = character.activeArchiveId;
        const results = await memoryEngine.retrieve(character, history, settings);
        if (character.activeArchiveId !== archiveId) return null;
        const built = build(results, settings);
        const historyText = history.map(message => {
            const parts = message.parts?.filter(part => part.type === 'text' || part.type === 'html').map(part => part.text);
            return parts?.length ? parts.join('\n') : (message.content || '');
        }).join('\n');
        return { ...built, systemTokens: countTextTokens(systemPrompt), historyTokens: countTextTokens(historyText),
            matches: results.length, debug: settings.debug, archiveId };
    }

    function parseUsage(data) {
        const usage = data?.usage ?? data?.usageMetadata;
        if (!usage) return null;
        const input = usage.prompt_tokens ?? usage.promptTokenCount;
        const output = usage.completion_tokens ?? usage.candidatesTokenCount;
        return Number.isFinite(input) || Number.isFinite(output) ? { input, output } : null;
    }

    async function complete(characterId, prepared, usage) {
        if (!prepared) return;
        const reports = lastRun.get(characterId) || new Map();
        reports.set(prepared.archiveId, {
            budget: prepared.budget, max: prepared.max,
            systemTokens: prepared.systemTokens, memoryTokens: prepared.tokens, historyTokens: prepared.historyTokens,
            matches: prepared.matches, used: prepared.used.length, ordinaryUsed: prepared.ordinaryUsed,
            code: prepared.used.some(hit => hit.entry.kind === 'code'), usage,
            ...(prepared.debug ? { decisions: prepared.decisions } : {})
        });
        lastRun.set(characterId, reports);
        if (prepared.used.length) await memoryRepository.recordRecall(characterId, prepared.used);
    }

    return { build, prepare, parseUsage, complete, stats(characterId) {
        const character = db.characters.find(item => item.id === characterId);
        return character ? lastRun.get(characterId)?.get(character.activeArchiveId) : undefined;
    } };
})();
;
// 每批仅发送限定范围的私聊文本，候选经用户确认后才成为记忆。
const memoryBatch = (() => {
    const current = new Set();
    const nextAutoAttempt = new Map();
    const normalize = value => value.normalize('NFKC').trim().toLowerCase();
    const batchKey = 'memoryBatchState';
    const stateFor = character => character[batchKey] || {};
    const pending = character => stateFor(character).pending;
    const stylePromptLimit = 1200;
    const cleanStylePrompt = value => typeof value === 'string' ? value.trim().slice(0, stylePromptLimit) : '';
    const unavailable = '请先在 API 设置中配置可用的模型';

    function bounds(settings) {
        const val = Math.trunc(Number(settings.batchSize));
        return Number.isFinite(val) && val >= 1 ? val : 30;
    }

    function messageText(message) {
        if (!message?.id || !['user', 'assistant'].includes(message.role) || message.isContextDisabled
            || message.isWithdrawn || message.isThinking || message.isStatusUpdate) return '';
        const parts = message.parts?.filter(part => part.type === 'text').map(part => part.text).join('\n');
        const plain = parts || (message.parts?.some(part => part.type === 'image') ? '' : message.content);
        return String(plain || '').replace(/data:[^\s]+/gi, '').trim().slice(0, 360);
    }

    function resumeIndex(history, state) {
        const index = state.endMessageId ? history.findIndex(message => message.id === state.endMessageId) : -1;
        if (index >= 0) return index + 1;
        if (!Number.isFinite(state.endTimestamp)) return 0;
        const next = history.findIndex(message => message.timestamp > state.endTimestamp);
        return next === -1 ? history.length : next;
    }

    function selectMessages(character, range) {
        const history = character.history || [];
        const state = stateFor(character);
        const resume = resumeIndex(history, state);
        const maxRows = range ? Infinity : bounds(memoryManagement.settingsFor(character));
        const start = range ? range.start - 1 : resume;
        const stop = range ? range.end : history.length;
        if (range && (!Number.isInteger(range.start) || !Number.isInteger(range.end)
            || start < 0 || start >= stop || stop > history.length)) {
            throw new Error('请输入有效的起始和结束消息编号');
        }

        const messages = [];
        let length = 0;
        let available = false;
        for (let index = start; index < stop; index++) {
            const message = history[index];
            const text = messageText(message);
            if (!text) continue;
            if (messages.length >= maxRows) {
                available = true;
                break;
            }
            const uName = (character.myName || '对方').trim().slice(0, 20);
            const cName = (character.realName || character.remarkName || character.name || '我').trim().slice(0, 20);
            messages.push({ id: message.id, speaker: message.role === 'user' ? uName : cName,
                text, timestamp: message.timestamp, number: index + 1 });
            length += text.length;
        }
        const last = messages.at(-1);
        const canAdvance = Boolean(last && last.number > resume);
        const hasGap = canAdvance && start > resume && history.slice(resume, start).some(messageText);
        const shouldAdvance = canAdvance && (!hasGap || range?.advancePastGap === true);
        const cursor = shouldAdvance ? { endMessageId: last.id, endTimestamp: last.timestamp }
            : { endMessageId: state.endMessageId, endTimestamp: state.endTimestamp };
        return { messages, available: available || messages.length >= maxRows, cursor, shouldAdvance, hasGap };
    }

    function parseCandidates(raw, messages, limit) {
        let cleaned = String(raw || '')
            .replace(/<(?:thinking|thought)>[\s\S]*?<\/(?:thinking|thought)>/gi, '')
            .trim();
        const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenceMatch) cleaned = fenceMatch[1].trim();

        const tryParseJson = str => {
            if (!str) return null;
            const fixed = str.replace(/,\s*([}\]])/g, '$1').trim();
            try { return JSON.parse(fixed); } catch { return null; }
        };

        const rescueObjects = str => {
            const items = [];
            let depth = 0, inStr = false, esc = false, start = -1;
            for (let i = 0; i < str.length; i++) {
                const ch = str[i];
                if (inStr) {
                    if (esc) esc = false;
                    else if (ch === '\\') esc = true;
                    else if (ch === '"') inStr = false;
                } else {
                    if (ch === '"') inStr = true;
                    else if (ch === '{') {
                        if (depth === 0) start = i;
                        depth++;
                    } else if (ch === '}') {
                        depth--;
                        if (depth === 0 && start !== -1) {
                            const obj = tryParseJson(str.slice(start, i + 1));
                            if (obj && typeof obj === 'object' && !Array.isArray(obj)) items.push(obj);
                            start = -1;
                        }
                    }
                }
            }
            return items;
        };

        let parsed = tryParseJson(cleaned);
        if (!parsed) {
            const firstArr = cleaned.indexOf('[');
            const lastArr = cleaned.lastIndexOf(']');
            const firstObj = cleaned.indexOf('{');
            const lastObj = cleaned.lastIndexOf('}');
            if (firstArr !== -1 && lastArr > firstArr) parsed = tryParseJson(cleaned.slice(firstArr, lastArr + 1));
            if (!parsed && firstObj !== -1 && lastObj > firstObj) parsed = tryParseJson(cleaned.slice(firstObj, lastObj + 1));
            if (!parsed) {
                const rescued = rescueObjects(cleaned);
                if (rescued.length) parsed = rescued;
            }
            if (!parsed) throw new Error(`模型返回不是合法 JSON（开头：${cleaned.slice(0, 60)}）`);
        }

        let data = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.entries) ? parsed.entries
            : Array.isArray(parsed?.candidates) ? parsed.candidates
            : Array.isArray(parsed?.memories) ? parsed.memories
            : Array.isArray(parsed?.items) ? parsed.items
            : Array.isArray(parsed?.data) ? parsed.data
            : (parsed && typeof parsed === 'object' && (parsed.title || parsed.summary || parsed.content)) ? [parsed]
            : null;
        if (!Array.isArray(data)) throw new Error('模型返回的候选格式不是数组');
        const bounded = Number.isFinite(limit) && limit > 0 ? data.slice(0, limit) : data;
        const candidates = new Map();
        for (const item of bounded) {
            if (!item || typeof item !== 'object') continue;
            let rawKind = String(item.kind ?? item.type ?? 'event').trim().toLowerCase();
            let inferredClass = String(item.recallClass ?? item.category ?? item.class ?? '').trim().toLowerCase();
            if (rawKind === 'evolution' || rawKind === 'growth') { rawKind = 'fact'; inferredClass ||= 'evolution'; }
            else if (rawKind === 'agreement' || rawKind === 'promise') { rawKind = 'event'; inferredClass ||= 'agreement'; }
            else if (rawKind === 'core') { rawKind = 'fact'; inferredClass ||= 'core'; }
            else if (rawKind === 'meme' || rawKind === 'slang' || rawKind === '暗号') { rawKind = 'code'; }
            else if (!['event', 'fact', 'code'].includes(rawKind)) { rawKind = 'event'; }
            const kind = rawKind;
            const title = String(item.title ?? item.name ?? '').trim().slice(0, 100);
            const meaning = String(item.meaning ?? item.summary ?? item.content ?? item.description ?? '').trim().slice(0, 450);
            const summary = String(item.summary ?? item.meaning ?? item.content ?? item.description ?? '').trim().slice(0, 450);
            if (!title || !summary) continue;

            const refSource = item.references ?? item.refs ?? item.ref ?? item.messageIds ?? [];
            const rawRefs = Array.isArray(refSource) ? refSource
                : (typeof refSource === 'number' || typeof refSource === 'string') ? String(refSource).split(/[,，、;\s]+/) : [];
            let validIndices = [...new Set(rawRefs
                .map(val => Number.parseInt(String(val).trim(), 10))
                .filter(index => Number.isInteger(index) && index > 0 && index <= messages.length))];
            if (!validIndices.length && messages.length) validIndices = [messages.length];
            const sourceMessageIds = [...new Set(validIndices.map(index => messages[index - 1].id))];
            if (!sourceMessageIds.length) continue;

            const kwSource = item.keywords ?? item.tags ?? [];
            const rawKw = Array.isArray(kwSource) ? kwSource
                : typeof kwSource === 'string' ? kwSource.split(/[,，、;\n]+/) : [];
            const keywords = rawKw.filter(word =>
                typeof word === 'string' && word.trim()).slice(0, 8).map(word => word.trim().slice(0, 40));
            const recallClass = ['ordinary', 'agreement', 'core', 'evolution'].includes(inferredClass) ? inferredClass : undefined;
            const refTimestamps = validIndices
                .map(index => messages[index - 1].timestamp)
                .filter(ts => Number.isSafeInteger(ts) && ts > 0);
            const eventAt = refTimestamps.length ? Math.max(...refTimestamps) : null;
            const key = kind + ':' + normalize(title);
            if (!candidates.has(key)) {
                if (kind === 'code') {
                    const rawTrig = Array.isArray(item.triggers) ? item.triggers
                        : typeof item.triggers === 'string' ? item.triggers.split(/[,，、;\n]+/) : [];
                    const triggers = rawTrig.map(t => typeof t === 'string' ? { kind: 'text', value: t.trim() }
                        : (t && typeof t === 'object' && t.value ? { kind: t.kind || 'text', value: String(t.value).trim() } : null))
                        .filter(t => t && t.value);
                    if (!triggers.length) triggers.push({ kind: 'text', value: title });
                    const rawAli = Array.isArray(item.aliases) ? item.aliases
                        : typeof item.aliases === 'string' ? item.aliases.split(/[,，、;\n]+/) : [];
                    const aliases = rawAli.map(a => String(a).trim()).filter(Boolean).slice(0, 8);
                    const responseGuidance = String(item.responseGuidance ?? item.guidance ?? '').trim().slice(0, 300);
                    candidates.set(key, { kind: 'code', title, summary: meaning, meaning, responseGuidance, triggers, aliases, keywords, sourceMessageIds, source: 'conversation', permanent: true, matchMode: 'exact_then_alias', ...(eventAt ? { eventAt } : {}) });
                } else {
                    candidates.set(key, { kind, title, summary, keywords, sourceMessageIds, source: 'conversation', ...(eventAt ? { eventAt } : {}), ...(recallClass ? { recallClass } : {}) });
                }
            }
        }
        if (data.length && !candidates.size) throw new Error('候选缺少有效的标题或摘要');
        return [...candidates.values()];
    }

    const maxReferenceTokens = 100000;

    function referenceFor(entry) {
        const clean = (value, limit) => String(value ?? '').replace(/data:[^\s]+/gi, '').trim().slice(0, limit);
        const summary = entry.kind === 'code' ? entry.meaning : entry.summary || entry.details;
        return { id: entry.id, kind: entry.kind, title: clean(entry.title, 80), summary: clean(summary, 150) };
    }

    function referenceTokens(references) {
        if (!references.length) return 0;
        const data = references.map(({ kind, title, summary }) => ({ kind, title, summary }));
        return countTextTokens(JSON.stringify({ existingMemories: data }));
    }

    function fitReferences(entries, budget) {
        const included = [];
        for (const entry of entries) {
            const reference = referenceFor(entry);
            if (referenceTokens([...included, reference]) <= budget) included.push(reference);
        }
        return included;
    }

    async function validateReferences(characterId, archiveId, approved) {
        if (!Array.isArray(approved) || approved.length > maxReferenceTokens
            || approved.some(entry => !entry || typeof entry.id !== 'string')) {
            throw new Error('已有记忆选择无效');
        }
        if (referenceTokens(approved) > maxReferenceTokens) throw new Error('已有记忆超出单批 Token 预算');
        if (!approved.length) return [];
        const entries = await memoryRepository.listForArchive(characterId, archiveId);
        const byId = new Map(entries.filter(entry => entry.enabled).map(entry => [entry.id, referenceFor(entry)]));
        if (new Set(approved.map(entry => entry?.id)).size !== approved.length) throw new Error('已有记忆选择重复');
        return approved.map(selected => {
            const current = byId.get(selected?.id);
            if (!current || ['kind', 'title', 'summary'].some(key => selected[key] !== current[key])) {
                throw new Error('所选记忆已变动，请关闭整理窗口后重新选择');
            }
            const { id, ...reference } = current;
            return reference;
        });
    }

    function extractionPrompt(limit, character, settings, focus = 'all') {
        const style = memoryEngine.styleFor(character, settings.recallStyle);
        const name = (character.realName || character.remarkName || character.name || '该角色').slice(0, 40);
        const userName = (character.myName || '对方').trim().slice(0, 40);
        const custom = cleanStylePrompt(settings.organizeStylePrompt).replace(/\{\{char\}\}/gi, () => name);
        const persona = settings.recallStyle === 'auto' && typeof character.persona === 'string'
            ? character.persona.trim().replace(/data:[^\s]+/gi, '').slice(0, 600) : '';
        const preference = custom
            ? `【角色整理偏好】${custom}`
            : `【角色整理偏好】${style.extraction}${persona ? `（人设参考：${persona}）` : ''}`;

        const livingVoiceRule = `【让记忆有“活人感”的写法要求（极其重要）】
- 直接使用真实称呼「${name}」和「${userName}」，严禁写成“用户”“角色”“AI”等系统代词。
- 拒绝冷冰冰的客服笔录体！用“${name}亲身经历并真正记在心上”的鲜活视角来写摘要：保留最能勾起画面的具体细节、小动作、关键原话（可带短引号）以及${name}当时真实的情绪态度（比如嘴硬心软、心疼、吃醋、觉得好笑又无奈）。
- 这样以后聊天把这条记忆发给${name}时，她能立刻接上真实情绪，像自己真的记得一样自然。`;

        const sharedRules = `【硬性输出规则（逐条遵守）】
1. 只输出一个合法 JSON 数组：必须以 "[" 开头，以 "]" 结尾。
2. 禁止输出思考过程、开场白、解释、注释、尾逗号、\`\`\`json 围栏。
3. 事实必须来自输入 messages，绝不编造；references 填支持该条的正整数编号数组（如 [1,2]）。
4. 跳过纯寒暄（如“在吗”“嗯”“哈哈”）、无意义水聊与无新进展的重复旧事。
5. 仅当整批对话完全没有符合目标的内容时，才输出 []。`;

        if (focus === 'agreement') {
            return `任务：以「${name}」的真实记忆视角，从聊天记录中【只提取重要约定与承诺】（最多 ${limit} 条）。
${preference}
${livingVoiceRule}

【记录侧重点】
- 双方确认的见面/出行/日常计划（尚未发生的写明“约定要做”及彼此期待）。
- 明确承诺、边界底线、安全词规则、生活或相处约定（写清约定内容与双方认真态度）。
- 忽略普通闲聊、未确认的随口提议。

${sharedRules}

【唯一允许的对象格式】
{"kind":"event","recallClass":"agreement","title":"约定主题","summary":"1-2句鲜活自然的话，写清具体约定、双方态度与是否已发生","keywords":["词1","词2"],"references":[1,2]}

【标准示例（仅参考格式与活人写法，勿抄内容）】
[
  {"kind":"event","recallClass":"agreement","title":"约定圣诞节一起去澳洲见家人","summary":"${name}和${userName}认真说好了今年圣诞节一起回澳洲见家人，${userName}准备去办护照；目前尚未成行，但${name}心里一直惦记着这事。","keywords":["圣诞节","澳洲","护照"],"references":[2,3]}
]`;
        }

        if (focus === 'code') {
            return `任务：以「${name}」的真实记忆视角，从聊天记录中【只提取专属暗号、昵称开关与内部梗】（最多 ${limit} 条）。
${preference}
${livingVoiceRule}

【记录侧重点】
- 特定词/表情触发的专属反应（如安全词、心软昵称、调情暗语）。
- 两人反复玩的内部梗、特定称呼与固定回应默契。
- 忽略普通一次性对话。

${sharedRules}

【唯一允许的对象格式】
{"kind":"code","title":"暗号或梗的名称","meaning":"用鲜活口吻写清这个暗号/梗的由来与背后的真实默契","responseGuidance":"${userName}触发时，${name}最自然、最有活人感的接招反应","triggers":["触发词1","触发词2"],"aliases":["别名"],"keywords":["关键词"],"references":[1,2]}

【标准示例（仅参考格式与活人写法，勿抄内容）】
[
  {"kind":"code","title":"心软开关「涂丽丽」","meaning":"${userName}一叫这个中文谐音昵称就是在撒娇求和，每次都能精准戳中${name}的软肋。","responseGuidance":"先嘴硬吐槽两句不许乱叫，但语气立刻软下来顺着她哄。","triggers":["涂丽丽","丽丽"],"aliases":["小丽丽"],"keywords":["涂丽丽","心软"],"references":[1,2]}
]`;
        }

        if (focus === 'evolution') {
            return `任务：以「${name}」的真实记忆视角，从聊天记录中【只提取阶段性成长与动态变化】（最多 ${limit} 条）。
${preference}
${livingVoiceRule}

【记录侧重点】
- 语言与线上打字习惯变化（如中文更熟练、错字减少但仍偏好中英夹杂）。
- 工作、薪资、项目、居住或生活作息变动。
- 双方相处方式、亲密称呼与照顾默契的演进。
- summary 必须写清“从过去什么状态 -> 变成现在什么状态”，便于后续对话直接以新状态呈现。

${sharedRules}

【唯一允许的对象格式】
{"kind":"fact","recallClass":"evolution","title":"变化主题","summary":"写清从过去状态到当前状态的自然演变与当下习惯","keywords":["词1","词2"],"references":[1,2]}

【标准示例（仅参考格式与活人写法，勿抄内容）】
[
  {"kind":"fact","recallClass":"evolution","title":"中文水平与线上打字习惯进步","summary":"和${userName}聊久了，${name}从早期老是拼音打错字进步到现在日常中文顺溜许多；不过她还是更偏爱中英夹杂，打快或激动时偶尔仍比普通中国人容易多打错几个字。","keywords":["中文进步","打字习惯","中英夹杂"],"references":[3,4]}
]`;
        }

        if (focus === 'core') {
            return `任务：以「${name}」的真实记忆视角，从聊天记录中【只提取核心设定与长期重要事实】（最多 ${limit} 条）。
${preference}
${livingVoiceRule}

【记录侧重点】
- 身份背景、重要人际关系与长期关系定位。
- 健康档案、过敏源、常用药与不可逾越的底线原则。

${sharedRules}

【唯一允许的对象格式】
{"kind":"fact","recallClass":"core","title":"核心事实主题","summary":"1-2句鲜活写清长期有效的核心事实与${name}的在意点","keywords":["词1","词2"],"references":[1,2]}

【标准示例（仅参考格式与活人写法，勿抄内容）】
[
  {"kind":"fact","recallClass":"core","title":"${userName}的猫毛过敏与用药记录","summary":"${userName}对猫毛严重过敏却总忍不住逗流浪猫，接触后必须立刻换衣服并按医嘱吃抗过敏药，${name}每次都会紧张盯着她处理。","keywords":["猫毛过敏","抗过敏药"],"references":[1,2]}
]`;
        }

        return `任务：以「${name}」的真实记忆视角，从聊天记录中综合整理长期记忆候选（最多 ${limit} 条）。
${preference}
${livingVoiceRule}

【记录侧重点优先级（按重要度从高到低抓取）】
1. 健康与情绪安全：生病、发烧、过敏、用药、身体不适、情绪低谷与安抚。
2. 重要约定与底线（kind:"event", recallClass:"agreement"）：双方确认的承诺、计划、规则与边界。
3. 角色成长与变化（kind:"fact", recallClass:"evolution"）：语言/打字习惯进步、工作收入变动、相处方式演进（写清前后变化）。
4. 专属暗号与高频梗（kind:"code"）：特定触发词、昵称开关、固定玩梗与回应默契。
5. 有情感重量的经历（kind:"event"）与稳定偏好（kind:"fact"）：重要见面、吃醋和好、固定喜好。

${sharedRules}

【对象格式速查】
- 普通经历/事实/约定/变化：{"kind":"event"|"fact","title":"标题","summary":"1-2句鲜活有画面感的摘要","keywords":["词1","词2"],"references":[1,2],"recallClass":"ordinary"|"agreement"|"core"|"evolution"}
- 暗号与梗：{"kind":"code","title":"名称","meaning":"由来与默契","responseGuidance":"自然接招方式","triggers":["触发词"],"aliases":["别名"],"keywords":["词1"],"references":[1,2]}

【标准示例（仅参考格式与活人写法，勿抄内容）】
[
  {"kind":"event","title":"发烧嗓子痛买药煮粥照护","summary":"${userName}发烧嗓子痛还硬撑，${name}赶紧买退烧药守在门口、笨拙地煮了粥，嘴上凶她乱跑其实心疼坏了。","keywords":["发烧","买药","煮粥"],"references":[1,2]},
  {"kind":"event","recallClass":"agreement","title":"约定周五晚在江汉路吃火锅","summary":"${name}和${userName}说好周五晚上七点去江汉路吃火锅，目前还没到时间，两人都挺期待。","keywords":["火锅","江汉路","周五约定"],"references":[3,4]},
  {"kind":"fact","recallClass":"evolution","title":"中文打字习惯进步","summary":"${name}从早期老打错字进步到现在日常中文顺溜多了，但依然偏爱中英夹杂，急起来偶尔还是会冒出几个错字。","keywords":["中文进步","打字习惯"],"references":[5,6]},
  {"kind":"code","title":"心软开关「涂丽丽」","meaning":"${userName}叫这个谐音昵称就是在撒娇求和，每次都能让${name}瞬间消气。","responseGuidance":"先嘴硬吐槽两句，但马上软下来哄人。","triggers":["涂丽丽","丽丽"],"aliases":["小丽丽"],"keywords":["涂丽丽"],"references":[7,8]}
]`;
    }

    async function generate(character, fallbackApi = resolveChatApiConfig(character), automatic = false, range, approvedReferences = [], focus = 'all') {
        if (pending(character)) return pending(character);
        if (current.has(character.id)) return null;
        const settings = memoryManagement.settingsFor(character);
        if (automatic && (!settings.enabled || !settings.autoOrganize
            || Date.now() < (nextAutoAttempt.get(character.id) ?? 0))) return null;
        const { messages, available, cursor } = selectMessages(character, range);
        if (!messages.length || (automatic && !available)) return null;
        const independent = db.apiSettings?.memoryOrganizer;
        const apiConfig = independent?.enabled ? independent : fallbackApi;
        if (!apiConfig?.url || !apiConfig.key || !apiConfig.model || BLOCKED_API_DOMAINS.some(domain => apiConfig.url.includes(domain))) {
            if (automatic) return null;
            throw new Error(independent?.enabled ? '请在 API 设置中补全长期记忆整理独立 API' : unavailable);
        }
        current.add(character.id);
        const archiveId = getActiveArchive(character).id;
        const rawInterval = Number(settings.autoIntervalMinutes);
        const interval = Number.isFinite(rawInterval) && rawInterval >= 0 ? rawInterval : 5;
        const rawCand = Math.trunc(Number(settings.batchMaxCandidates));
        const candidateLimit = Number.isFinite(rawCand) && rawCand >= 1 ? rawCand : 5;
        try {
            const existingMemories = await validateReferences(character.id, archiveId, approvedReferences);
            if (character.activeArchiveId !== archiveId) return null;
            nextAutoAttempt.set(character.id, Date.now() + interval * 60000);
            const payload = { messages: messages.map(({ speaker, text }, index) => ({ reference: index + 1, speaker, text })) };
            if (existingMemories.length) payload.existingMemories = existingMemories;
            const { requestBody, endpoint, headers } = buildChatApiRequest(apiConfig, [
                { role: 'system', content: extractionPrompt(candidateLimit, character, settings, focus) },
                { role: 'user', content: `以下是本批待整理的私聊记录（共 ${messages.length} 条）：\n${JSON.stringify(payload)}\n\n请提取其中值得记住的内容，直接输出合法的 JSON 数组（以 [ 开头，以 ] 结尾）。` }
            ], { temperature: 0.4 });
            const raw = await fetchAiResponse({ ...apiConfig, streamEnabled: false }, requestBody, headers, endpoint,
                false, { signal: AbortSignal.timeout(180000) });
            const candidates = parseCandidates(raw, messages, candidateLimit)
                .map(candidate => ({ ...candidate, archiveId }));
            if (!db.characters.includes(character) || character.activeArchiveId !== archiveId) return null;
            const previous = character[batchKey];
            character[batchKey] = candidates.length
                ? { ...stateFor(character), pending: { candidates, ...cursor } }
                : cursor;
            try {
                await saveData();
            } catch (error) {
                character[batchKey] = previous;
                throw error;
            }
            return pending(character) ?? { candidates: [], rawPreview: String(raw || '').trim().slice(0, 120) };
        } finally {
            current.delete(character.id);
        }
    }

    async function confirmBatch(character, review, selected, changes = {}) {
        if (current.has(character.id) || pending(character) !== review) throw new Error('候选已更新，请重新打开');
        current.add(character.id);
        const previous = character[batchKey];
        const archiveId = getActiveArchive(character).id;
        const keyFor = entry => JSON.stringify([entry.archiveId ?? null, entry.kind, normalize(entry.title)]);
        try {
            return await dexieDB.transaction('rw', dexieDB.tables, async () => {
                const entries = await memoryRepository.list(character.id);
                if (character.activeArchiveId !== archiveId || pending(character) !== review) throw new Error('候选已更新，请重新打开');
                const byTitle = new Map(entries.map(entry => [keyFor(entry), entry]));
                let created = 0;
                let merged = 0;
                for (const [index, original] of review.candidates.entries()) {
                    if (!selected.includes(index)) continue;
                    const revision = changes[index];
                    const candidate = original.kind === 'code' ? {
                        ...original,
                        ...(revision ? {
                            title: revision.title.trim(),
                            meaning: (revision.meaning ?? revision.summary ?? '').trim(),
                            summary: (revision.meaning ?? revision.summary ?? '').trim(),
                            responseGuidance: (revision.responseGuidance ?? '').trim(),
                            triggers: Array.isArray(revision.triggers) && revision.triggers.length ? revision.triggers : original.triggers,
                            aliases: Array.isArray(revision.aliases) ? revision.aliases : original.aliases
                        } : {}),
                        archiveId: revision?.shared === true ? null : archiveId
                    } : {
                        ...original,
                        ...(revision ? { title: revision.title.trim(), summary: revision.summary.trim() } : {}),
                        ...(revision?.recallClass && { recallClass: revision.recallClass }),
                        archiveId: revision?.shared === true ? null : archiveId
                    };
                    if (!candidate.title || !candidate.summary || candidate.title.length > 100 || candidate.summary.length > 450) {
                        throw new Error('已选候选需填写标题和摘要');
                    }
                    const key = keyFor(candidate);
                    const existing = byTitle.get(key);
                    const related = new Set(candidate.keywords.map(normalize));
                    const linkedEntryIds = entries.filter(entry => memoryRepository.inArchive(entry, candidate.archiveId)
                        && entry.kind !== 'code' && entry.id !== existing?.id
                        && entry.keywords.some(word => related.has(normalize(word)))).slice(0, 5).map(entry => entry.id);
                    if (existing) {
                        const updated = await memoryRepository.update(character.id, existing.id, {
                            ...(candidate.recallClass && { recallClass: candidate.recallClass }),
                            ...(revision?.replaceSummary === true ? { summary: candidate.summary } : {}),
                            keywords: [...new Set([...existing.keywords, ...candidate.keywords])],
                            sourceMessageIds: [...new Set([...existing.sourceMessageIds, ...candidate.sourceMessageIds])],
                            linkedEntryIds: [...new Set([...existing.linkedEntryIds, ...linkedEntryIds])]
                        });
                        byTitle.set(key, updated);
                        merged++;
                    } else {
                        const entry = await memoryRepository.create(character.id, { ...candidate, linkedEntryIds });
                        entries.push(entry);
                        byTitle.set(key, entry);
                        created++;
                    }
                }
                if (character.activeArchiveId !== archiveId || pending(character) !== review) throw new Error('候选已更新，请重新打开');
                character[batchKey] = { endMessageId: review.endMessageId, endTimestamp: review.endTimestamp };
                await saveData();
                return { created, merged };
            });
        } catch (error) {
            if (character.activeArchiveId === archiveId) character[batchKey] = previous;
            throw error;
        } finally {
            current.delete(character.id);
        }
    }

    return { stylePromptLimit, cleanStylePrompt, pending, generate, confirm: confirmBatch, selectMessages, messageText, referenceFor, referenceTokens, fitReferences, maxReferenceTokens };
})();