// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { JsonSchemaDataStore } from '@theia/core/lib/browser/json-schema-store';
import { IJSONSchema } from '@theia/core/lib/common/json-schema';
import URI from '@theia/core/lib/common/uri';

/**
 * Serializes in-memory JSON schemas on first read instead of on every write.
 *
 * The preference schema contribution rewrites the four `vscode://schemas/settings/*` schemas every
 * time a preference schema changes: once per plugin and preference contribution during startup.
 * Upstream stringifies the whole (multi-megabyte) schema on each write, which was a quarter of the
 * frontend startup CPU. The strings are only read when the JSON language service or a settings
 * editor opens such a resource, so the last written object is stringified then, once.
 */
@injectable()
export class QaapLazyJsonSchemaDataStore extends JsonSchemaDataStore {

    protected readonly unserializedSchemas = new Map<string, IJSONSchema>();

    override hasSchema(uri: URI): boolean {
        return this.unserializedSchemas.has(uri.toString()) || super.hasSchema(uri);
    }

    override getSchema(uri: URI): string | undefined {
        const key = uri.toString();
        const schema = this.unserializedSchemas.get(key);
        if (schema) {
            this.unserializedSchemas.delete(key);
            this._schemas.set(key, JSON.stringify(schema));
        }
        return super.getSchema(uri);
    }

    override setSchema(uri: URI, schema: IJSONSchema | string): void {
        if (typeof schema === 'string') {
            this.unserializedSchemas.delete(uri.toString());
            super.setSchema(uri, schema);
            return;
        }
        this._schemas.delete(uri.toString());
        this.unserializedSchemas.set(uri.toString(), schema);
        this.notifySchemaUpdate(uri);
    }

    override deleteSchema(uri: URI): void {
        if (this.unserializedSchemas.delete(uri.toString())) {
            this._schemas.delete(uri.toString());
            this.notifySchemaUpdate(uri);
            return;
        }
        super.deleteSchema(uri);
    }
}
