import { S3ClientWrapper, createS3Client } from './s3-client';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/lib-storage');
jest.mock('tar', () => ({
  create: jest.fn(async (opts: { file: string }) => {
    const fsMod = require('fs/promises');
    await fsMod.writeFile(opts.file, 'dummy tarball');
  }),
  extract: jest.fn().mockResolvedValue(undefined),
}));

describe('S3ClientWrapper', () => {
  let s3Client: S3ClientWrapper;
  let mockS3: { send: jest.Mock };
  let tempDir: string;

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 's3-client-test-'));

    // Mock S3Client
    mockS3 = {
      send: jest.fn(),
    } as any;

    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(() => mockS3 as unknown as S3Client);

    s3Client = new S3ClientWrapper('us-east-1');
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('upload', () => {
    it('should upload string content', async () => {
      mockS3.send.mockResolvedValueOnce({});

      const result = await s3Client.upload({
        bucket: 'test-bucket',
        key: 'test.txt',
        body: 'test content',
        contentType: 'text/plain',
      });

      expect(result).toBe('s3://test-bucket/test.txt');
      expect(PutObjectCommand).toHaveBeenCalledWith({
            Bucket: 'test-bucket',
            Key: 'test.txt',
            Body: 'test content',
            ContentType: 'text/plain',
            Metadata: undefined,
        });
        expect(mockS3.send).toHaveBeenCalled();
    });

    it('should upload buffer content', async () => {
      mockS3.send.mockResolvedValueOnce({});

      const buffer = Buffer.from('test content');
      const result = await s3Client.upload({
        bucket: 'test-bucket',
        key: 'test.bin',
        body: buffer,
      });

      expect(result).toBe('s3://test-bucket/test.bin');
      expect(PutObjectCommand).toHaveBeenCalled();
    });

    it('should upload stream content', async () => {
      const mockUpload = {
        done: jest.fn().mockResolvedValue({}),
      };

      (Upload as jest.MockedClass<typeof Upload>).mockImplementation(() => mockUpload as any);

      const stream = Readable.from(['test content']);
      const result = await s3Client.upload({
        bucket: 'test-bucket',
        key: 'test.txt',
        body: stream,
        contentType: 'text/plain',
      });

      expect(result).toBe('s3://test-bucket/test.txt');
      expect(mockUpload.done).toHaveBeenCalled();
    });

    it('should include metadata in upload', async () => {
      mockS3.send.mockResolvedValueOnce({});

      await s3Client.upload({
        bucket: 'test-bucket',
        key: 'test.txt',
        body: 'content',
        metadata: { runId: 'run-123', shard: '0' },
      });

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
            Metadata: { runId: 'run-123', shard: '0' },
        })
      );
    });

    it('should throw error on upload failure', async () => {
      mockS3.send.mockRejectedValueOnce(new Error('Upload failed'));

      await expect(
        s3Client.upload({
          bucket: 'test-bucket',
          key: 'test.txt',
          body: 'content',
        })
      ).rejects.toThrow('Failed to upload to S3');
    });
  });

  describe('download', () => {
    it('should download content to buffer', async () => {
      const mockBody = Readable.from([Buffer.from('test content')]);

      mockS3.send.mockResolvedValueOnce({
        Body: mockBody,
      });

      const result = await s3Client.download({
        bucket: 'test-bucket',
        key: 'test.txt',
      });

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('test content');
    });

    it('should download content to file', async () => {
      const mockBody = Readable.from([Buffer.from('test content')]);

      mockS3.send.mockResolvedValueOnce({
        Body: mockBody,
      });

      const destination = path.join(tempDir, 'downloaded.txt');
      const result = await s3Client.download({
        bucket: 'test-bucket',
        key: 'test.txt',
        destination,
      });

      expect(result).toBe(destination);
      const content = await fs.readFile(destination, 'utf-8');
      expect(content).toBe('test content');
    });

    it('should create destination directory if needed', async () => {
      const mockBody = Readable.from([Buffer.from('content')]);

      mockS3.send.mockResolvedValueOnce({
        Body: mockBody,
      });

      const destination = path.join(tempDir, 'nested', 'dir', 'file.txt');
      await s3Client.download({
        bucket: 'test-bucket',
        key: 'test.txt',
        destination,
      });

      const exists = await fs.access(destination).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should throw error when object not found', async () => {
      const error = new Error('Not found');
      (error as any).name = 'NoSuchKey';

      mockS3.send.mockRejectedValueOnce(error);

      await expect(
        s3Client.download({
          bucket: 'test-bucket',
          key: 'missing.txt',
        })
      ).rejects.toThrow('Object not found');
    });

    it('should throw error when response body is empty', async () => {
      mockS3.send.mockResolvedValueOnce({
        Body: undefined,
      });

      await expect(
        s3Client.download({
          bucket: 'test-bucket',
          key: 'test.txt',
        })
      ).rejects.toThrow('Empty response body from S3');
    });
  });

  describe('delete', () => {
    it('should delete object', async () => {
      mockS3.send.mockResolvedValueOnce({});

      await s3Client.delete({
        bucket: 'test-bucket',
        key: 'test.txt',
      });

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
            Bucket: 'test-bucket',
            Key: 'test.txt',
      });
      expect(mockS3.send).toHaveBeenCalled();
    });

    it('should throw error on delete failure', async () => {
      mockS3.send.mockRejectedValueOnce(new Error('Delete failed'));

      await expect(
        s3Client.delete({
          bucket: 'test-bucket',
          key: 'test.txt',
        })
      ).rejects.toThrow('Failed to delete from S3');
    });
  });

  describe('list', () => {
    it('should list objects with prefix', async () => {
      mockS3.send.mockResolvedValueOnce({
        Contents: [
          { Key: 'runs/run-123/file1.txt' },
          { Key: 'runs/run-123/file2.txt' },
          { Key: 'runs/run-123/file3.txt' },
        ],
      });

      const keys = await s3Client.list({
        bucket: 'test-bucket',
        prefix: 'runs/run-123/',
      });

      expect(keys).toEqual([
        'runs/run-123/file1.txt',
        'runs/run-123/file2.txt',
        'runs/run-123/file3.txt',
      ]);
    });

    it('should handle empty list', async () => {
      mockS3.send.mockResolvedValueOnce({
        Contents: [],
      });

      const keys = await s3Client.list({
        bucket: 'test-bucket',
        prefix: 'runs/',
      });

      expect(keys).toEqual([]);
    });

    it('should handle missing Contents', async () => {
      mockS3.send.mockResolvedValueOnce({});

      const keys = await s3Client.list({
        bucket: 'test-bucket',
      });

      expect(keys).toEqual([]);
    });

    it('should respect maxKeys parameter', async () => {
      mockS3.send.mockResolvedValueOnce({
        Contents: [{ Key: 'file1.txt' }],
      });

      await s3Client.list({
        bucket: 'test-bucket',
        maxKeys: 10,
      });

      expect(ListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
            MaxKeys: 10,
        })
      );
    });

    it('should throw error on list failure', async () => {
      mockS3.send.mockRejectedValueOnce(new Error('List failed'));

      await expect(
        s3Client.list({
          bucket: 'test-bucket',
        })
      ).rejects.toThrow('Failed to list S3 objects');
    });
  });

  describe('exists', () => {
    it('should return true when object exists', async () => {
      mockS3.send.mockResolvedValueOnce({});

      const exists = await s3Client.exists('test-bucket', 'test.txt');

      expect(exists).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      const error = new Error('Not found');
      (error as any).name = 'NotFound';

      mockS3.send.mockRejectedValueOnce(error);

      const exists = await s3Client.exists('test-bucket', 'missing.txt');

      expect(exists).toBe(false);
    });

    it('should return false when NoSuchKey error', async () => {
      const error = new Error('No such key');
      (error as any).name = 'NoSuchKey';

      mockS3.send.mockRejectedValueOnce(error);

      const exists = await s3Client.exists('test-bucket', 'missing.txt');

      expect(exists).toBe(false);
    });

    it('should throw error for other failures', async () => {
      mockS3.send.mockRejectedValueOnce(new Error('Access denied'));

      await expect(
        s3Client.exists('test-bucket', 'test.txt')
      ).rejects.toThrow('Failed to check S3 object existence');
    });
  });

  describe('uploadJSON', () => {
    it('should upload JSON data', async () => {
      mockS3.send.mockResolvedValueOnce({});

      const data = { foo: 'bar', baz: 123 };
      const result = await s3Client.uploadJSON('test-bucket', 'data.json', data);

      expect(result).toBe('s3://test-bucket/data.json');
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
            ContentType: 'application/json',
            Body: JSON.stringify(data, null, 2),
        })
      );
    });

    it('should include metadata when provided', async () => {
      mockS3.send.mockResolvedValueOnce({});

      await s3Client.uploadJSON(
        'test-bucket',
        'data.json',
        { test: true },
        { runId: 'run-123' }
      );

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
            Metadata: { runId: 'run-123' },
        })
      );
    });
  });

  describe('downloadJSON', () => {
    it('should download and parse JSON', async () => {
      const data = { foo: 'bar', baz: 123 };
      const mockBody = Readable.from([Buffer.from(JSON.stringify(data))]);

      mockS3.send.mockResolvedValueOnce({
        Body: mockBody,
      });

      const result = await s3Client.downloadJSON('test-bucket', 'data.json');

      expect(result).toEqual(data);
    });

    it('should handle nested JSON structures', async () => {
      const data = {
        nested: {
          deeply: {
            value: 'test',
          },
        },
        array: [1, 2, 3],
      };
      const mockBody = Readable.from([Buffer.from(JSON.stringify(data))]);

      mockS3.send.mockResolvedValueOnce({
        Body: mockBody,
      });

      const result = await s3Client.downloadJSON('test-bucket', 'data.json');

      expect(result).toEqual(data);
    });
  });

  describe('getMetadata', () => {
    it('should return object metadata', async () => {
      mockS3.send.mockResolvedValueOnce({
        Metadata: {
          runId: 'run-123',
          shard: '0',
        },
      });

      const metadata = await s3Client.getMetadata('test-bucket', 'test.txt');

      expect(metadata).toEqual({
        runId: 'run-123',
        shard: '0',
      });
    });

    it('should return empty object when no metadata', async () => {
      mockS3.send.mockResolvedValueOnce({});

      const metadata = await s3Client.getMetadata('test-bucket', 'test.txt');

      expect(metadata).toEqual({});
    });

    it('should throw error on failure', async () => {
      mockS3.send.mockRejectedValueOnce(new Error('Failed'));

      await expect(
        s3Client.getMetadata('test-bucket', 'test.txt')
      ).rejects.toThrow('Failed to get metadata');
    });
  });

  describe('getSize', () => {
    it('should return object size', async () => {
      mockS3.send.mockResolvedValueOnce({
        ContentLength: 12345,
      });

      const size = await s3Client.getSize('test-bucket', 'test.txt');

      expect(size).toBe(12345);
    });

    it('should return 0 when ContentLength is missing', async () => {
      mockS3.send.mockResolvedValueOnce({});

      const size = await s3Client.getSize('test-bucket', 'test.txt');

      expect(size).toBe(0);
    });

    it('should throw error on failure', async () => {
      mockS3.send.mockRejectedValueOnce(new Error('Failed'));

      await expect(
        s3Client.getSize('test-bucket', 'test.txt')
      ).rejects.toThrow('Failed to get object size');
    });
  });

  describe('getUrl', () => {
    it('should generate S3 URL', () => {
      const url = s3Client.getUrl('test-bucket', 'path/to/file.txt');

      expect(url).toBe('s3://test-bucket/path/to/file.txt');
    });
  });

  describe('getHttpsUrl', () => {
    it('should generate HTTPS URL', () => {
      const url = s3Client.getHttpsUrl('test-bucket', 'path/to/file.txt', 'us-east-1');

      expect(url).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/path/to/file.txt');
    });
  });

  describe('uploadDirectory', () => {
    it('should create tarball and upload', async () => {
      // Create test directory with files
      const testDir = path.join(tempDir, 'test-dir');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'content2');

      // Mock upload to succeed
      const mockUpload = {
        done: jest.fn().mockResolvedValue({}),
      };
      (Upload as jest.MockedClass<typeof Upload>).mockImplementation(() => mockUpload as any);

      const result = await s3Client.uploadDirectory(
        testDir,
        'test-bucket',
        'test.tar.gz'
      );

      expect(result).toBe('s3://test-bucket/test.tar.gz');
      expect(mockUpload.done).toHaveBeenCalled();
    });

    it('should clean up temporary tarball', async () => {
      const testDir = path.join(tempDir, 'test-dir');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content');

      const mockUpload = {
        done: jest.fn().mockResolvedValue({}),
      };
      (Upload as jest.MockedClass<typeof Upload>).mockImplementation(() => mockUpload as any);

      await s3Client.uploadDirectory(testDir, 'test-bucket', 'test.tar.gz');

      // Check that tarball was cleaned up
      const tarballPath = path.join(tempDir, 'test-dir.tar.gz');
      const exists = await fs.access(tarballPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('downloadAndExtract', () => {
    it('should download and extract tarball', async () => {
      const mockBody = Readable.from([Buffer.from('tarball content')]);

      mockS3.send.mockResolvedValueOnce({
        Body: mockBody,
      });

      const destination = path.join(tempDir, 'dest');
      await fs.mkdir(destination, { recursive: true });

      await s3Client.downloadAndExtract('test-bucket', 'test.tar.gz', destination);

      const tarMock = jest.requireMock<{ extract: jest.Mock }>('tar');
      expect(tarMock.extract).toHaveBeenCalledWith({
        file: path.join(destination, 'temp.tar.gz'),
        cwd: destination,
      });

      // Check that temporary tarball was cleaned up
      const tempTarball = path.join(destination, 'temp.tar.gz');
      const exists = await fs.access(tempTarball).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('createS3Client', () => {
    it('should create S3ClientWrapper instance', () => {
      const client = createS3Client('us-west-2');

      expect(client).toBeInstanceOf(S3ClientWrapper);
    });
  });
});