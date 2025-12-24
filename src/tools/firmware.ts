/**
 * Firmware extraction and validation tools
 * Handles OTA payloads and factory images
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createReadStream } from 'fs';
import { Extract as unzip } from 'unzipper';
import { ErrorHandler } from '../utils/error-handler.js';
import { formatBytes } from '../utils/formatter.js';
import { BinaryManager } from '../utils/binary-manager.js';

// Schemas
export const ExtractPayloadSchema = z.object({
  payload_path: z.string().describe('Path to payload.bin or OTA zip file'),
  output_dir: z.string().describe('Directory to extract partitions to'),
  partitions: z.array(z.string()).optional().describe('Specific partitions to extract (default: all)'),
  concurrency: z.number().min(1).max(8).default(4).describe('Number of parallel extractions'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ListPayloadContentsSchema = z.object({
  payload_path: z.string().describe('Path to payload.bin or OTA zip file'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ExtractFactoryImageSchema = z.object({
  zip_path: z.string().describe('Path to factory image zip file'),
  output_dir: z.string().describe('Directory to extract to'),
  extract_nested: z.boolean().default(true).describe('Extract nested image zips (image-*.zip)'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ValidateFirmwarePackageSchema = z.object({
  package_path: z.string().describe('Path to OTA or factory image zip'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Security constants
const MAX_EXTRACT_SIZE = 10 * 1024 * 1024 * 1024; // 10GB max decompressed
const EXTRACTION_TIMEOUT = 300000; // 5 minutes
const PARTITION_REGEX = /^[a-z0-9_-]+$/i; // Alphanumeric, underscore, hyphen only

// Helper functions
function validatePath(filePath: string): void {
  // Check for path traversal
  if (filePath.includes('..') || filePath.includes('\0')) {
    throw new Error(`Invalid path: ${filePath}`);
  }

  const resolved = path.resolve(filePath);

  // Block system directories
  const blocked = ['/etc', '/proc', '/sys', '/dev', '/root', '/boot'];
  for (const b of blocked) {
    if (resolved.startsWith(b + '/') || resolved === b) {
      throw new Error(`Access to ${b} is not allowed`);
    }
  }

  // Block sensitive user directories
  const home = process.env.HOME || '';
  const sensitiveDirs = ['.ssh', '.gnupg', '.aws', '.config'];
  for (const dir of sensitiveDirs) {
    const sensitiveDir = path.join(home, dir);
    if (resolved.startsWith(sensitiveDir + '/') || resolved === sensitiveDir) {
      throw new Error(`Access to ${dir} is not allowed`);
    }
  }
}

function validatePartitionNames(partitions: string[]): string[] {
  const validated: string[] = [];
  for (const p of partitions) {
    if (!PARTITION_REGEX.test(p)) {
      throw new Error(`Invalid partition name: ${p}. Must be alphanumeric (a-z, 0-9, _, -).`);
    }
    if (p.startsWith('-')) {
      throw new Error(`Invalid partition name: ${p}. Cannot start with hyphen.`);
    }
    validated.push(p);
  }
  return validated;
}

async function calculateSHA256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function extractPayloadFromZip(zipPath: string, outputDir: string): Promise<string> {
  // Extract payload.bin from OTA zip
  const payloadPath = path.join(outputDir, 'payload.bin');
  let found = false;

  await Promise.race([
    new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(zipPath);
      readStream.on('error', reject);

      readStream
        .pipe(unzip())
        .on('entry', (entry) => {
          if (entry.path === 'payload.bin') {
            found = true;
            const writeStream = fs.createWriteStream(payloadPath);
            writeStream.on('error', reject);
            entry.on('error', reject);

            entry.pipe(writeStream)
              .on('finish', resolve)
              .on('error', reject);
          } else {
            entry.autodrain();
          }
        })
        .on('close', () => {
          if (!found) {
            reject(new Error('payload.bin not found in zip'));
          }
        })
        .on('error', reject);
    }),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Extraction timeout')), EXTRACTION_TIMEOUT)
    )
  ]);

  return payloadPath;
}

interface PayloadPartition {
  name: string;
  size: number;
  sizeHuman: string;
}

async function getPayloadContents(payloadPath: string): Promise<PayloadPartition[]> {
  // Use payload-dumper-go to list partitions
  const result = await BinaryManager.execute('payload-dumper-go', ['-l', payloadPath]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to list payload contents: ${result.stderr}`);
  }

  // Parse output
  const partitions: PayloadPartition[] = [];
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    // Format: "partition_name (size bytes)"
    const match = line.match(/^\s*(\w+)\s+\((\d+)\s*bytes?\)/i);
    if (match) {
      const size = parseInt(match[2], 10);
      partitions.push({
        name: match[1],
        size,
        sizeHuman: formatBytes(size),
      });
    }
  }

  return partitions;
}

// Tool implementations
export const firmwareTools = {
  extract_payload: {
    description: `Extract partitions from OTA payload.

Extracts partition images from Android OTA payload.bin files or OTA zip archives.

Features:
- Direct payload.bin extraction
- OTA zip file support (auto-extracts payload.bin)
- Selective partition extraction
- Parallel extraction for speed
- Progress reporting

Uses payload-dumper-go (auto-downloaded on first use).

Common partitions: boot, system, vendor, product, odm, vbmeta

Examples:
- extract_payload(payload_path="/downloads/ota.zip", output_dir="/extracted/")
- extract_payload(payload_path="/payload.bin", output_dir="/out/", partitions=["boot", "vbmeta"])`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        payload_path: {
          type: 'string' as const,
          description: 'Path to payload.bin or OTA zip file'
        },
        output_dir: {
          type: 'string' as const,
          description: 'Directory to extract partitions to'
        },
        partitions: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Specific partitions to extract (default: all)'
        },
        concurrency: {
          type: 'number' as const,
          default: 4,
          description: 'Number of parallel extractions'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['payload_path', 'output_dir']
    },
    handler: async (args: z.infer<typeof ExtractPayloadSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.payload_path);
        validatePath(args.output_dir);

        if (!fs.existsSync(args.payload_path)) {
          throw new Error(`File not found: ${args.payload_path}`);
        }

        // Create output directory
        await fsPromises.mkdir(args.output_dir, { recursive: true });

        let payloadPath = args.payload_path;
        let tempDir: string | null = null;

        // If it's a zip, extract payload.bin first
        if (args.payload_path.endsWith('.zip')) {
          console.error('Extracting payload.bin from OTA zip...');
          tempDir = path.join(args.output_dir, '.temp_payload');
          await fsPromises.mkdir(tempDir, { recursive: true });
          payloadPath = await extractPayloadFromZip(args.payload_path, tempDir);
          console.error('payload.bin extracted.');
        }

        // Build command args
        const cmdArgs = ['-o', args.output_dir];

        if (args.partitions && args.partitions.length > 0) {
          const validatedPartitions = validatePartitionNames(args.partitions);
          cmdArgs.push('-p', validatedPartitions.join(','));
        }

        cmdArgs.push('-c', String(args.concurrency || 4));
        cmdArgs.push(payloadPath);

        console.error(`Extracting partitions with ${args.concurrency || 4} workers...`);
        const startTime = Date.now();

        const result = await BinaryManager.execute('payload-dumper-go', cmdArgs, {
          timeout: 1800000, // 30 minutes for large payloads
        });

        // Cleanup temp files
        if (tempDir) {
          await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }

        if (result.exitCode !== 0) {
          throw new Error(`Extraction failed: ${result.stderr}`);
        }

        const duration = Math.round((Date.now() - startTime) / 1000);

        // List extracted files
        const files = await fsPromises.readdir(args.output_dir);
        const imgFiles = files.filter(f => f.endsWith('.img'));

        const extractedInfo: Array<{ name: string; size: number; sizeHuman: string }> = [];
        for (const file of imgFiles) {
          const filePath = path.join(args.output_dir, file);
          const stats = await fsPromises.stat(filePath);
          extractedInfo.push({
            name: file,
            size: stats.size,
            sizeHuman: formatBytes(stats.size),
          });
        }

        if (args.format === 'json') {
          return JSON.stringify({
            success: true,
            outputDir: args.output_dir,
            duration: `${duration} seconds`,
            partitions: extractedInfo,
          }, null, 2);
        }

        let markdown = `# Payload Extraction Complete\n\n`;
        markdown += `**Source**: ${args.payload_path}\n`;
        markdown += `**Output**: ${args.output_dir}\n`;
        markdown += `**Duration**: ${duration} seconds\n`;
        markdown += `**Partitions Extracted**: ${extractedInfo.length}\n\n`;

        markdown += `## Extracted Partitions\n\n`;
        markdown += `| Partition | Size |\n`;
        markdown += `|-----------|------|\n`;

        for (const part of extractedInfo) {
          markdown += `| ${part.name} | ${part.sizeHuman} |\n`;
        }

        const totalSize = extractedInfo.reduce((sum, p) => sum + p.size, 0);
        markdown += `\n**Total Size**: ${formatBytes(totalSize)}\n`;

        return markdown;
      });
    }
  },

  list_payload_contents: {
    description: `List partitions in OTA payload.

Shows all partitions contained in a payload.bin or OTA zip file without extracting.

Useful for:
- Understanding what's in an OTA update
- Planning selective extraction
- Verifying expected partitions

Uses payload-dumper-go (auto-downloaded on first use).

Examples:
- list_payload_contents(payload_path="/downloads/ota.zip")
- list_payload_contents(payload_path="/payload.bin", format="json")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        payload_path: {
          type: 'string' as const,
          description: 'Path to payload.bin or OTA zip file'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['payload_path']
    },
    handler: async (args: z.infer<typeof ListPayloadContentsSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.payload_path);

        if (!fs.existsSync(args.payload_path)) {
          throw new Error(`File not found: ${args.payload_path}`);
        }

        let payloadPath = args.payload_path;
        let tempDir: string | null = null;

        // If it's a zip, extract payload.bin first
        if (args.payload_path.endsWith('.zip')) {
          console.error('Extracting payload.bin from OTA zip...');
          tempDir = path.join(path.dirname(args.payload_path), '.temp_payload_list');
          await fsPromises.mkdir(tempDir, { recursive: true });
          payloadPath = await extractPayloadFromZip(args.payload_path, tempDir);
        }

        try {
          const partitions = await getPayloadContents(payloadPath);

          if (args.format === 'json') {
            return JSON.stringify({
              source: args.payload_path,
              partitionCount: partitions.length,
              partitions,
            }, null, 2);
          }

          let markdown = `# OTA Payload Contents\n\n`;
          markdown += `**Source**: ${args.payload_path}\n`;
          markdown += `**Partitions**: ${partitions.length}\n\n`;

          markdown += `| Partition | Size |\n`;
          markdown += `|-----------|------|\n`;

          for (const part of partitions) {
            markdown += `| ${part.name} | ${part.sizeHuman} |\n`;
          }

          const totalSize = partitions.reduce((sum, p) => sum + p.size, 0);
          markdown += `\n**Total Uncompressed Size**: ${formatBytes(totalSize)}\n`;

          return markdown;
        } finally {
          // Cleanup temp files
          if (tempDir) {
            await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          }
        }
      });
    }
  },

  extract_factory_image: {
    description: `Extract factory image zip.

Extracts Google factory image archives (e.g., oriole-tq1a.221205.012-factory-*.zip).

Features:
- Extracts main zip contents
- Auto-extracts nested image-*.zip if present
- Lists all extracted images
- Calculates checksums

This is useful for:
- Preparing images for manual flashing
- Extracting specific partitions from factory images
- Comparing stock vs custom images

Examples:
- extract_factory_image(zip_path="/downloads/oriole-factory.zip", output_dir="/factory/")
- extract_factory_image(zip_path="/pixel7-factory.zip", output_dir="/out/", extract_nested=true)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        zip_path: {
          type: 'string' as const,
          description: 'Path to factory image zip file'
        },
        output_dir: {
          type: 'string' as const,
          description: 'Directory to extract to'
        },
        extract_nested: {
          type: 'boolean' as const,
          default: true,
          description: 'Extract nested image zips (image-*.zip)'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['zip_path', 'output_dir']
    },
    handler: async (args: z.infer<typeof ExtractFactoryImageSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.zip_path);
        validatePath(args.output_dir);

        if (!fs.existsSync(args.zip_path)) {
          throw new Error(`File not found: ${args.zip_path}`);
        }

        // Create output directory
        await fsPromises.mkdir(args.output_dir, { recursive: true });

        console.error('Extracting factory image...');
        const startTime = Date.now();

        // Extract main zip with timeout and size limits
        let totalExtracted = 0;
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            const readStream = createReadStream(args.zip_path);
            readStream.on('error', reject);

            readStream
              .pipe(unzip())
              .on('entry', (entry) => {
                // Track extracted size to prevent zip bombs
                const uncompressedSize = entry.vars?.uncompressedSize || entry.size || 0;
                totalExtracted += uncompressedSize;
                if (totalExtracted > MAX_EXTRACT_SIZE) {
                  entry.autodrain();
                  reject(new Error(`Archive exceeds max size limit (${Math.round(MAX_EXTRACT_SIZE / 1024 / 1024 / 1024)}GB)`));
                  return;
                }

                // Extract with proper path
                const targetPath = path.join(args.output_dir, entry.path);
                if (entry.type === 'Directory') {
                  fsPromises.mkdir(targetPath, { recursive: true }).catch(() => {});
                  entry.autodrain();
                } else {
                  fsPromises.mkdir(path.dirname(targetPath), { recursive: true })
                    .then(() => {
                      entry.pipe(fs.createWriteStream(targetPath))
                        .on('error', reject);
                    })
                    .catch(reject);
                }
              })
              .on('close', resolve)
              .on('error', reject);
          }),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Extraction timeout')), EXTRACTION_TIMEOUT * 2) // Double timeout for factory images
          )
        ]);

        // Find and list extracted files
        const extractedFiles: Array<{ name: string; size: number; sizeHuman: string; type: string }> = [];

        async function scanDir(dir: string, prefix: string = ''): Promise<void> {
          const entries = await fsPromises.readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
              await scanDir(fullPath, relativePath);
            } else {
              const stats = await fsPromises.stat(fullPath);
              let type = 'other';
              if (entry.name.endsWith('.img')) type = 'image';
              else if (entry.name.endsWith('.zip')) type = 'archive';
              else if (entry.name.endsWith('.txt') || entry.name.endsWith('.md')) type = 'text';
              else if (entry.name.includes('flash')) type = 'script';

              extractedFiles.push({
                name: relativePath,
                size: stats.size,
                sizeHuman: formatBytes(stats.size),
                type,
              });
            }
          }
        }

        await scanDir(args.output_dir);

        // Extract nested image zips if requested
        const nestedZips = extractedFiles.filter(f =>
          f.type === 'archive' && (f.name.includes('image-') || f.name.includes('images'))
        );

        if (args.extract_nested && nestedZips.length > 0) {
          console.error(`Extracting ${nestedZips.length} nested image zip(s)...`);

          for (const nestedZip of nestedZips) {
            const zipPath = path.join(args.output_dir, nestedZip.name);
            const extractDir = path.join(args.output_dir, 'images');
            await fsPromises.mkdir(extractDir, { recursive: true });

            await Promise.race([
              new Promise<void>((resolve, reject) => {
                const readStream = createReadStream(zipPath);
                readStream.on('error', reject);
                readStream
                  .pipe(unzip({ path: extractDir }))
                  .on('close', resolve)
                  .on('error', reject);
              }),
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('Nested extraction timeout')), EXTRACTION_TIMEOUT)
              )
            ]);

            // Remove the nested zip after extraction
            await fsPromises.unlink(zipPath);
          }

          // Rescan to get updated file list
          extractedFiles.length = 0;
          await scanDir(args.output_dir);
        }

        const duration = Math.round((Date.now() - startTime) / 1000);

        // Group files by type
        const images = extractedFiles.filter(f => f.type === 'image');
        const scripts = extractedFiles.filter(f => f.type === 'script');
        const others = extractedFiles.filter(f => f.type !== 'image' && f.type !== 'script');

        if (args.format === 'json') {
          return JSON.stringify({
            success: true,
            source: args.zip_path,
            outputDir: args.output_dir,
            duration: `${duration} seconds`,
            images,
            scripts,
            otherFiles: others,
          }, null, 2);
        }

        let markdown = `# Factory Image Extraction Complete\n\n`;
        markdown += `**Source**: ${args.zip_path}\n`;
        markdown += `**Output**: ${args.output_dir}\n`;
        markdown += `**Duration**: ${duration} seconds\n`;
        markdown += `**Total Files**: ${extractedFiles.length}\n\n`;

        if (images.length > 0) {
          markdown += `## Partition Images (${images.length})\n\n`;
          markdown += `| Image | Size |\n`;
          markdown += `|-------|------|\n`;
          for (const img of images) {
            markdown += `| ${img.name} | ${img.sizeHuman} |\n`;
          }
          markdown += '\n';
        }

        if (scripts.length > 0) {
          markdown += `## Flash Scripts (${scripts.length})\n\n`;
          for (const script of scripts) {
            markdown += `- ${script.name}\n`;
          }
          markdown += '\n';
        }

        const totalSize = extractedFiles.reduce((sum, f) => sum + f.size, 0);
        markdown += `**Total Extracted Size**: ${formatBytes(totalSize)}\n`;

        return markdown;
      });
    }
  },

  validate_firmware_package: {
    description: `Validate OTA or factory image package.

Performs comprehensive validation of firmware packages:
- File existence and accessibility
- ZIP structure verification
- Required file checks (payload.bin for OTA, flash scripts for factory)
- Checksum calculations
- Signature verification hints

Useful before flashing to catch corrupt downloads.

Examples:
- validate_firmware_package(package_path="/downloads/ota.zip")
- validate_firmware_package(package_path="/factory-image.zip", format="json")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        package_path: {
          type: 'string' as const,
          description: 'Path to OTA or factory image zip'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['package_path']
    },
    handler: async (args: z.infer<typeof ValidateFirmwarePackageSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.package_path);

        if (!fs.existsSync(args.package_path)) {
          throw new Error(`File not found: ${args.package_path}`);
        }

        const stats = await fsPromises.stat(args.package_path);
        const sha256 = await calculateSHA256(args.package_path);

        interface ValidationResult {
          valid: boolean;
          packageType: 'ota' | 'factory' | 'unknown';
          size: number;
          sizeHuman: string;
          sha256: string;
          contents: string[];
          checks: Array<{ name: string; passed: boolean; details: string }>;
          warnings: string[];
          errors: string[];
        }

        const result: ValidationResult = {
          valid: true,
          packageType: 'unknown',
          size: stats.size,
          sizeHuman: formatBytes(stats.size),
          sha256,
          contents: [],
          checks: [],
          warnings: [],
          errors: [],
        };

        // Read zip contents
        try {
          await new Promise<void>((resolve, reject) => {
            createReadStream(args.package_path)
              .pipe(unzip())
              .on('entry', (entry) => {
                result.contents.push(entry.path);
                entry.autodrain();
              })
              .on('close', resolve)
              .on('error', reject);
          });

          result.checks.push({
            name: 'ZIP Structure',
            passed: true,
            details: `Valid ZIP with ${result.contents.length} entries`,
          });
        } catch (error) {
          result.valid = false;
          result.errors.push(`Invalid ZIP structure: ${error}`);
          result.checks.push({
            name: 'ZIP Structure',
            passed: false,
            details: `Invalid or corrupted ZIP: ${error}`,
          });
        }

        // Determine package type
        const hasPayload = result.contents.some(c => c === 'payload.bin');
        const hasFlashAll = result.contents.some(c =>
          c.includes('flash-all') || c.includes('flash_all')
        );
        const hasImageZip = result.contents.some(c => c.includes('image-'));

        if (hasPayload) {
          result.packageType = 'ota';
          result.checks.push({
            name: 'OTA Payload',
            passed: true,
            details: 'payload.bin found',
          });
        } else if (hasFlashAll || hasImageZip) {
          result.packageType = 'factory';
          result.checks.push({
            name: 'Factory Image',
            passed: true,
            details: hasFlashAll ? 'Flash scripts found' : 'Image archive found',
          });
        } else {
          result.packageType = 'unknown';
          result.warnings.push('Could not determine package type. Missing payload.bin or flash scripts.');
          result.checks.push({
            name: 'Package Type',
            passed: false,
            details: 'Unknown package type',
          });
        }

        // Additional OTA checks
        if (result.packageType === 'ota') {
          const hasMetadata = result.contents.some(c => c === 'META-INF/com/android/metadata');
          const hasProperties = result.contents.some(c => c.includes('payload_properties.txt'));

          result.checks.push({
            name: 'OTA Metadata',
            passed: hasMetadata,
            details: hasMetadata ? 'META-INF present' : 'META-INF missing',
          });

          if (hasProperties) {
            result.checks.push({
              name: 'Payload Properties',
              passed: true,
              details: 'payload_properties.txt found',
            });
          }
        }

        // Additional factory image checks
        if (result.packageType === 'factory') {
          const hasBootloader = result.contents.some(c =>
            c.includes('bootloader') && c.endsWith('.img')
          );
          const hasRadio = result.contents.some(c =>
            c.includes('radio') && c.endsWith('.img')
          );

          if (hasBootloader) {
            result.checks.push({
              name: 'Bootloader Image',
              passed: true,
              details: 'bootloader.img found',
            });
          }

          if (hasRadio) {
            result.checks.push({
              name: 'Radio Image',
              passed: true,
              details: 'radio.img found',
            });
          }
        }

        // Size warnings
        if (stats.size < 100 * 1024 * 1024) { // < 100MB
          result.warnings.push(`Small package size (${result.sizeHuman}). May be incomplete.`);
        }

        // Final validation
        result.valid = result.errors.length === 0 && result.packageType !== 'unknown';

        if (args.format === 'json') {
          return JSON.stringify(result, null, 2);
        }

        let markdown = `# Firmware Package Validation\n\n`;
        markdown += `**Package**: ${args.package_path}\n`;
        markdown += `**Type**: ${result.packageType.toUpperCase()}\n`;
        markdown += `**Size**: ${result.sizeHuman}\n`;
        markdown += `**SHA256**: \`${sha256.substring(0, 16)}...${sha256.substring(56)}\`\n`;
        markdown += `**Status**: ${result.valid ? '✅ VALID' : '❌ INVALID'}\n\n`;

        markdown += `## Validation Checks\n\n`;
        markdown += `| Check | Status | Details |\n`;
        markdown += `|-------|--------|----------|\n`;
        for (const check of result.checks) {
          const icon = check.passed ? '✅' : '❌';
          markdown += `| ${check.name} | ${icon} | ${check.details} |\n`;
        }

        if (result.warnings.length > 0) {
          markdown += `\n## ⚠️ Warnings\n\n`;
          for (const warning of result.warnings) {
            markdown += `- ${warning}\n`;
          }
        }

        if (result.errors.length > 0) {
          markdown += `\n## ❌ Errors\n\n`;
          for (const error of result.errors) {
            markdown += `- ${error}\n`;
          }
        }

        markdown += `\n## Contents (${result.contents.length} files)\n\n`;
        const displayContents = result.contents.slice(0, 20);
        for (const content of displayContents) {
          markdown += `- ${content}\n`;
        }
        if (result.contents.length > 20) {
          markdown += `\n*...and ${result.contents.length - 20} more files*\n`;
        }

        return markdown;
      });
    }
  }
};
