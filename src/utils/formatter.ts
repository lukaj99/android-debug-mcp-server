/**
 * Response formatting utility for Markdown and JSON output
 */

import { CONFIG } from '../config.js';
import type { OutputFormat, DetailLevel } from '../types.js';

export class ResponseFormatter {
  /**
   * Format response based on output type
   */
  static format(
    data: any,
    format: OutputFormat = 'markdown',
    detail: DetailLevel = 'concise'
  ): string {
    let result: string;

    if (format === 'json') {
      result = JSON.stringify(data, null, 2);
    } else {
      result = this.formatMarkdown(data, detail);
    }

    // Enforce character limit
    if (result.length > CONFIG.CHARACTER_LIMIT) {
      const truncateAt = CONFIG.CHARACTER_LIMIT - 100;
      result = result.substring(0, truncateAt) + '\n\n... [Response truncated due to length. Use format="json" or filter results for complete output]';
    }

    return result;
  }

  /**
   * Format data as Markdown
   */
  private static formatMarkdown(data: any, detail: DetailLevel): string {
    if (Array.isArray(data)) {
      return this.formatArray(data, detail);
    } else if (typeof data === 'object' && data !== null) {
      return this.formatObject(data, detail);
    } else {
      return String(data);
    }
  }

  /**
   * Format array as Markdown list/table
   */
  private static formatArray(items: any[], detail: DetailLevel): string {
    if (items.length === 0) {
      return '*No items found*';
    }

    // If items are objects, create table
    if (typeof items[0] === 'object' && items[0] !== null) {
      return this.formatTable(items, detail);
    }

    // Otherwise, create bulleted list
    return items.map(item => `- ${item}`).join('\n');
  }

  /**
   * Format object as Markdown
   */
  private static formatObject(obj: any, _detail: DetailLevel): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const formatted = this.formatValue(value);
      lines.push(`**${this.titleCase(key)}**: ${formatted}`);
    }

    return lines.join('\n');
  }

  /**
   * Format array of objects as Markdown table
   */
  private static formatTable(items: any[], detail: DetailLevel): string {
    if (items.length === 0) return '*No items found*';

    // Get all unique keys
    const allKeys = new Set<string>();
    items.forEach(item => {
      Object.keys(item).forEach(key => allKeys.add(key));
    });

    // Filter keys based on detail level
    let keys = Array.from(allKeys);
    if (detail === 'concise') {
      // Show only important keys
      const priorityKeys = ['id', 'name', 'mode', 'status', 'enabled', 'model', 'version', 'size', 'path'];
      keys = keys.filter(k => priorityKeys.includes(k.toLowerCase()));

      // Limit to first 5 keys if still too many
      if (keys.length > 5) {
        keys = keys.slice(0, 5);
      }
    }

    if (keys.length === 0) {
      keys = Object.keys(items[0]).slice(0, 5);
    }

    // Create header
    const header = `| ${keys.map(k => this.titleCase(k)).join(' | ')} |`;
    const separator = `| ${keys.map(() => '---').join(' | ')} |`;

    // Create rows
    const rows = items.map(item => {
      const values = keys.map(key => {
        const value = item[key];
        return this.formatValue(value, 30); // Limit cell width
      });
      return `| ${values.join(' | ')} |`;
    });

    return [header, separator, ...rows].join('\n');
  }

  /**
   * Format a single value for display
   */
  private static formatValue(value: any, maxLength = 100): string {
    if (value === null || value === undefined) {
      return '-';
    }

    if (typeof value === 'boolean') {
      return value ? '✓' : '✗';
    }

    if (typeof value === 'object') {
      value = JSON.stringify(value);
    }

    let str = String(value);

    // Truncate if too long
    if (str.length > maxLength) {
      str = str.substring(0, maxLength - 3) + '...';
    }

    return str;
  }

  /**
   * Convert string to title case
   */
  private static titleCase(str: string): string {
    return str
      .replace(/([A-Z])/g, ' $1') // Add space before capitals
      .replace(/^./, s => s.toUpperCase()) // Capitalize first letter
      .replace(/_/g, ' ') // Replace underscores with spaces
      .trim();
  }

  /**
   * Format success message
   */
  static success(message: string, data?: any): string {
    let result = `✅ **Success**: ${message}\n\n`;

    if (data) {
      result += this.formatMarkdown(data, 'concise');
    }

    return result;
  }

  /**
   * Format error message
   */
  static error(message: string, suggestion?: string): string {
    let result = `❌ **Error**: ${message}\n\n`;

    if (suggestion) {
      result += `💡 **Suggestion**: ${suggestion}`;
    }

    return result;
  }

  /**
   * Format warning message
   */
  static warning(message: string): string {
    return `⚠️ **Warning**: ${message}`;
  }
}
