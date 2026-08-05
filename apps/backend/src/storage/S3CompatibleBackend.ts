import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { FileEntry, FolderNode } from '@alliminate/shared';
import type { StorageBackend } from './StorageBackend';
import type { S3CompatConfig } from '../config';

export class S3CompatibleBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;

  constructor(cfg: S3CompatConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      endpoint: `https://${cfg.endpoint}`,
      region: cfg.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async list(prefix: string): Promise<FileEntry[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );

    return (res.Contents ?? []).map((obj) => ({
      path: obj.Key ?? '',
      size: obj.Size ?? 0,
      hash: (obj.ETag ?? '').replace(/"/g, ''),
      modifiedAt: obj.LastModified?.toISOString() ?? new Date(0).toISOString(),
    }));
  }

  /** S3 has no real folders — Delimiter:'/' turns shared key prefixes into "folders" (CommonPrefixes),
   * the standard S3-console convention. `folderId` IS the key prefix (ending in "/"); null = bucket root. */
  async browseFolder(folderId: string | null): Promise<{ folders: FolderNode[]; files: FileEntry[] }> {
    const prefix = folderId ?? '';
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, Delimiter: '/' }),
    );
    const folders: FolderNode[] = (res.CommonPrefixes ?? [])
      .map((p) => p.Prefix ?? '')
      .filter(Boolean)
      .map((p) => ({ id: p, name: p.slice(prefix.length, -1) }));
    const files: FileEntry[] = (res.Contents ?? [])
      .filter((obj) => obj.Key && obj.Key !== prefix) // skip the zero-byte folder-marker object itself
      .map((obj) => ({
        path: (obj.Key ?? '').slice(prefix.length),
        size: obj.Size ?? 0,
        hash: (obj.ETag ?? '').replace(/"/g, ''),
        modifiedAt: obj.LastModified?.toISOString() ?? new Date(0).toISOString(),
      }));
    return { folders, files };
  }

  /** Zero-byte object with a key ending in "/" — the standard S3 convention for a visible empty folder. */
  async makeFolder(parentId: string | null, name: string): Promise<FolderNode> {
    const key = `${parentId ?? ''}${name}/`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: Buffer.alloc(0) }));
    return { id: key, name };
  }

  async putInFolder(folderId: string | null, name: string, data: Buffer): Promise<void> {
    await this.put(`${folderId ?? ''}${name}`, data);
  }
}
