import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import path from 'path';
import * as tar from 'tar';

export interface S3UploadOptions {
  bucket: string;
  key: string;
  body: string | Buffer | Readable;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface S3DownloadOptions {
  bucket: string;
  key: string;
  destination?: string;
}

export interface S3DeleteOptions {
  bucket: string;
  key: string;
}

export interface S3ListOptions {
  bucket: string;
  prefix?: string;
  maxKeys?: number;
}

export class S3ClientWrapper {
  private client: S3Client;
  private region: string;

  constructor(region: string) {
    this.region = region;
    this.client = new S3Client({ region });
  }

  /**
   * Check if bucket exists, create it if not
   */
  async ensureBucketExists(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        // Bucket doesn't exist, create it
        const createParams: any = { Bucket: bucket };

        // LocationConstraint is required for all regions except us-east-1
        if (this.region !== 'us-east-1') {
          createParams.CreateBucketConfiguration = {
            LocationConstraint: this.region,
          };
        }

        await this.client.send(new CreateBucketCommand(createParams));
      } else {
        throw new Error(`Failed to check bucket: ${err.message}`);
      }
    }
  }

  /**
   * Upload content to S3
   */
  async upload(options: S3UploadOptions): Promise<string> {
    const { bucket, key, body, contentType, metadata } = options;

    try {
      // For small uploads, use PutObjectCommand
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        await this.client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            Metadata: metadata,
          })
        );
      } else {
        // For streams, use Upload for better handling of large files
        const upload = new Upload({
          client: this.client,
          params: {
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            Metadata: metadata,
          },
        });

        await upload.done();
      }

      return `s3://${bucket}/${key}`;
    } catch (err: any) {
      throw new Error(`Failed to upload to S3: ${err.message}`);
    }
  }

  /**
   * Download content from S3
   */
  async download(options: S3DownloadOptions): Promise<string | Buffer> {
    const { bucket, key, destination } = options;

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

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Save to file if destination provided
      if (destination) {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, buffer);
        return destination;
      }

      return buffer;
    } catch (err: any) {
      if (err.name === 'NoSuchKey') {
        throw new Error(`Object not found: s3://${bucket}/${key}`);
      }
      throw new Error(`Failed to download from S3: ${err.message}`);
    }
  }

  /**
   * Delete object from S3
   */
  async delete(options: S3DeleteOptions): Promise<void> {
    const { bucket, key } = options;

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
    } catch (err: any) {
      throw new Error(`Failed to delete from S3: ${err.message}`);
    }
  }

  /**
   * List objects in S3
   */
  async list(options: S3ListOptions): Promise<string[]> {
    const { bucket, prefix, maxKeys = 1000 } = options;

    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
        })
      );

      return (response.Contents || []).map((obj) => obj.Key!).filter(Boolean);
    } catch (err: any) {
      throw new Error(`Failed to list S3 objects: ${err.message}`);
    }
  }

  /**
   * Check if object exists
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') {
        return false;
      }
      throw new Error(`Failed to check S3 object existence: ${err.message}`);
    }
  }

  /**
   * Upload directory as tarball
   */
  async uploadDirectory(
    directory: string,
    bucket: string,
    key: string
  ): Promise<string> {
    try {
      // Create tarball in memory
      const tarballPath = path.join(
        path.dirname(directory),
        `${path.basename(directory)}.tar.gz`
      );

      // Create tar.gz, excluding node_modules to avoid version conflicts
      await tar.create(
        {
          gzip: true,
          file: tarballPath,
          cwd: path.dirname(directory),
          filter: (filePath: string) => {
            // Exclude node_modules directories
            return !filePath.includes('node_modules');
          },
        },
        [path.basename(directory)]
      );

      // Verify tarball was created (defensive check for file system sync)
      await fs.access(tarballPath);

      // Upload tarball
      const stream = createReadStream(tarballPath);
      const result = await this.upload({
        bucket,
        key,
        body: stream,
        contentType: 'application/gzip',
      });

      // Clean up temporary tarball
      await fs.unlink(tarballPath);

      return result;
    } catch (err: any) {
      throw new Error(`Failed to upload directory: ${err.message}`);
    }
  }

  /**
   * Download and extract tarball
   */
  async downloadAndExtract(
    bucket: string,
    key: string,
    destination: string
  ): Promise<void> {
    try {
      // Download tarball
      const tarballPath = path.join(destination, 'temp.tar.gz');
      await this.download({ bucket, key, destination: tarballPath });

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

  /**
   * Upload JSON data
   */
  async uploadJSON(
    bucket: string,
    key: string,
    data: any,
    metadata?: Record<string, string>
  ): Promise<string> {
    const body = JSON.stringify(data, null, 2);
    return this.upload({
      bucket,
      key,
      body,
      contentType: 'application/json',
      metadata,
    });
  }

  /**
   * Download and parse JSON
   */
  async downloadJSON<T = any>(bucket: string, key: string): Promise<T> {
    const buffer = await this.download({ bucket, key });
    return JSON.parse(buffer.toString('utf-8'));
  }

  /**
   * Get object metadata
   */
  async getMetadata(
    bucket: string,
    key: string
  ): Promise<Record<string, string>> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      return response.Metadata || {};
    } catch (err: any) {
      throw new Error(`Failed to get metadata: ${err.message}`);
    }
  }

  /**
   * Get object size
   */
  async getSize(bucket: string, key: string): Promise<number> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      return response.ContentLength || 0;
    } catch (err: any) {
      throw new Error(`Failed to get object size: ${err.message}`);
    }
  }

  /**
   * Generate S3 URL
   */
  getUrl(bucket: string, key: string): string {
    return `s3://${bucket}/${key}`;
  }

  /**
   * Generate HTTPS URL
   */
  getHttpsUrl(bucket: string, key: string, region: string): string {
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}

/**
 * Convenience function to create S3 client
 */
export function createS3Client(region: string): S3ClientWrapper {
  return new S3ClientWrapper(region);
}