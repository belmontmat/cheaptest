import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';
import tar from 'tar';
import { Readable } from 'stream';

export class S3ClientWrapper {
  private client: S3Client;

  constructor(region: string) {
    this.client = new S3Client({ region });
  }

  async downloadAndExtract(
    bucket: string,
    key: string,
    destination: string
  ): Promise<void> {
    try {
      // Download tarball
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      if (!response.Body) {
        throw new Error('Empty response body from S3');
      }

      // Save to temp file
      const tarballPath = path.join(destination, 'temp.tar.gz');
      await fs.mkdir(destination, { recursive: true });

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(tarballPath, buffer);

      // Extract
      await tar.extract({
        file: tarballPath,
        cwd: destination,
      });

      // Clean up tarball
      await fs.unlink(tarballPath);
    } catch (err: any) {
      throw new Error(`Failed to download and extract: ${err.message}`);
    }
  }

  async downloadJSON<T = any>(bucket: string, key: string): Promise<T> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      if (!response.Body) {
        throw new Error('Empty response body from S3');
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      return JSON.parse(buffer.toString('utf-8'));
    } catch (err: any) {
      throw new Error(`Failed to download JSON: ${err.message}`);
    }
  }

  async uploadJSON(
    bucket: string,
    key: string,
    data: any,
    metadata?: Record<string, string>
  ): Promise<void> {
    try {
      const body = JSON.stringify(data, null, 2);

      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          Metadata: metadata,
        })
      );
    } catch (err: any) {
      throw new Error(`Failed to upload JSON: ${err.message}`);
    }
  }
}