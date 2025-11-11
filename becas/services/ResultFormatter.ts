import { ExecutionResult } from './QueryExecutor';
import { ParsedQuery } from './QueryParser';
import { EmbedBuilder } from 'discord.js';
import logger from '../utils/logger';

/**
 * ResultFormatter
 *
 * Formats SQL query results into human-readable Discord messages.
 *
 * Supports:
 * - Tables (for list results)
 * - Summary cards (for aggregations)
 * - Charts (ASCII art for trends)
 * - CSV/JSON export
 * - Discord embeds
 */

export interface FormattedResult {
  type: 'table' | 'summary' | 'chart' | 'error';
  content: string;
  embed?: EmbedBuilder;
  file?: { name: string; content: string };
}

export class ResultFormatter {
  /**
   * Format query result for Discord
   */
  format(
    executionResult: ExecutionResult,
    parsedQuery: ParsedQuery,
    question: string
  ): FormattedResult {
    if (!executionResult.success) {
      return this.formatError(executionResult.error || 'Unknown error', question);
    }

    if (executionResult.rowCount === 0) {
      return this.formatEmpty(question);
    }

    // Determine format type based on result structure
    const formatType = this.detectFormatType(executionResult.rows, parsedQuery);

    switch (formatType) {
      case 'summary':
        return this.formatSummary(executionResult, parsedQuery, question);
      case 'chart':
        return this.formatChart(executionResult, parsedQuery, question);
      case 'table':
      default:
        return this.formatTable(executionResult, parsedQuery, question);
    }
  }

  /**
   * Detect best format type for results
   */
  private detectFormatType(rows: any[], parsedQuery: ParsedQuery): 'table' | 'summary' | 'chart' {
    // Single row with aggregate (COUNT, AVG, SUM, etc.) → Summary
    if (rows.length === 1 && Object.keys(rows[0]).some(k => k.includes('count') || k.includes('avg') || k.includes('sum'))) {
      return 'summary';
    }

    // Time series data → Chart
    if (rows.length > 5 && rows[0].created_at) {
      return 'chart';
    }

    // Multiple rows → Table
    return 'table';
  }

  /**
   * Format as summary card
   */
  private formatSummary(
    executionResult: ExecutionResult,
    parsedQuery: ParsedQuery,
    question: string
  ): FormattedResult {
    const row = executionResult.rows[0];
    const keys = Object.keys(row);

    const embed = new EmbedBuilder()
      .setTitle('📊 Query Result')
      .setDescription(question)
      .setColor(0x00AE86)
      .setTimestamp();

    // Add fields for each column
    keys.forEach(key => {
      const value = row[key];
      const formattedValue = this.formatValue(value);
      embed.addFields({ name: this.formatColumnName(key), value: formattedValue, inline: true });
    });

    // Add metadata
    embed.setFooter({
      text: `Executed in ${executionResult.executionTime}ms${executionResult.cached ? ' (cached)' : ''}`
    });

    return {
      type: 'summary',
      content: parsedQuery.explanation || 'Query result',
      embed
    };
  }

  /**
   * Format as table
   */
  private formatTable(
    executionResult: ExecutionResult,
    parsedQuery: ParsedQuery,
    question: string
  ): FormattedResult {
    const rows = executionResult.rows.slice(0, 20); // Max 20 rows in Discord
    const keys = Object.keys(rows[0]);

    // Create ASCII table
    const table = this.createAsciiTable(rows, keys);

    const embed = new EmbedBuilder()
      .setTitle('📋 Query Results')
      .setDescription(question)
      .setColor(0x00AE86)
      .setTimestamp();

    embed.addFields({
      name: 'Results',
      value: `\`\`\`\n${table}\n\`\`\``
    });

    // Show row count
    if (executionResult.rowCount > 20) {
      embed.addFields({
        name: 'Note',
        value: `Showing 20 of ${executionResult.rowCount} results. Use export for full data.`
      });
    } else {
      embed.addFields({
        name: 'Total',
        value: `${executionResult.rowCount} row(s)`
      });
    }

    embed.setFooter({
      text: `Executed in ${executionResult.executionTime}ms${executionResult.cached ? ' (cached)' : ''}`
    });

    // If more than 20 rows, offer CSV export
    let file;
    if (executionResult.rowCount > 20) {
      file = this.exportToCSV(executionResult.rows, keys);
    }

    return {
      type: 'table',
      content: parsedQuery.explanation || 'Query results',
      embed,
      file
    };
  }

  /**
   * Format as chart (ASCII art)
   */
  private formatChart(
    executionResult: ExecutionResult,
    parsedQuery: ParsedQuery,
    question: string
  ): FormattedResult {
    const rows = executionResult.rows;

    // Simple bar chart
    const chart = this.createBarChart(rows);

    const embed = new EmbedBuilder()
      .setTitle('📈 Query Results')
      .setDescription(question)
      .setColor(0x00AE86)
      .setTimestamp();

    embed.addFields({
      name: 'Trend',
      value: `\`\`\`\n${chart}\n\`\`\``
    });

    embed.setFooter({
      text: `Executed in ${executionResult.executionTime}ms${executionResult.cached ? ' (cached)' : ''}`
    });

    return {
      type: 'chart',
      content: parsedQuery.explanation || 'Query results',
      embed
    };
  }

  /**
   * Format error
   */
  private formatError(error: string, question: string): FormattedResult {
    const embed = new EmbedBuilder()
      .setTitle('❌ Query Error')
      .setDescription(question)
      .setColor(0xFF0000)
      .setTimestamp();

    embed.addFields({
      name: 'Error',
      value: error
    });

    return {
      type: 'error',
      content: 'Query failed',
      embed
    };
  }

  /**
   * Format empty result
   */
  private formatEmpty(question: string): FormattedResult {
    const embed = new EmbedBuilder()
      .setTitle('📭 No Results')
      .setDescription(question)
      .setColor(0xFFA500)
      .setTimestamp();

    embed.addFields({
      name: 'Result',
      value: 'No data found matching your query.'
    });

    return {
      type: 'summary',
      content: 'No results',
      embed
    };
  }

  /**
   * Create ASCII table
   */
  private createAsciiTable(rows: any[], columns: string[]): string {
    // Calculate column widths
    const widths: { [key: string]: number } = {};
    columns.forEach(col => {
      widths[col] = Math.max(
        col.length,
        ...rows.map(row => String(row[col] || '').length)
      );
      widths[col] = Math.min(widths[col], 30); // Max 30 chars per column
    });

    // Header
    const header = columns.map(col => this.pad(this.formatColumnName(col), widths[col])).join(' | ');
    const separator = columns.map(col => '-'.repeat(widths[col])).join('-+-');

    // Rows
    const rowStrings = rows.map(row => {
      return columns.map(col => {
        const value = this.formatValue(row[col]);
        return this.pad(value, widths[col]);
      }).join(' | ');
    });

    return [header, separator, ...rowStrings].join('\n');
  }

  /**
   * Create bar chart (ASCII)
   */
  private createBarChart(rows: any[]): string {
    if (rows.length === 0) return 'No data';

    // Find numeric column
    const firstRow = rows[0];
    const numericCol = Object.keys(firstRow).find(k => typeof firstRow[k] === 'number');
    if (!numericCol) return 'No numeric data for chart';

    // Find label column
    const labelCol = Object.keys(firstRow).find(k => k !== numericCol) || 'value';

    // Get max value for scaling
    const values = rows.map(r => r[numericCol] || 0);
    const maxValue = Math.max(...values);
    const maxBarLength = 40;

    // Create bars
    const bars = rows.slice(0, 15).map(row => {
      const label = String(row[labelCol] || '').substring(0, 20);
      const value = row[numericCol] || 0;
      const barLength = Math.round((value / maxValue) * maxBarLength);
      const bar = '█'.repeat(barLength);
      return `${this.pad(label, 20)} | ${bar} ${value}`;
    });

    return bars.join('\n');
  }

  /**
   * Format column name (remove underscores, capitalize)
   */
  private formatColumnName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Format value for display
   */
  private formatValue(value: any): string {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value instanceof Date) return value.toISOString().split('T')[0];
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return value.toString();
      return value.toFixed(2);
    }
    if (typeof value === 'string' && value.length > 50) {
      return value.substring(0, 47) + '...';
    }
    return String(value);
  }

  /**
   * Pad string to width
   */
  private pad(str: string, width: number): string {
    if (str.length > width) return str.substring(0, width - 3) + '...';
    return str + ' '.repeat(width - str.length);
  }

  /**
   * Export to CSV
   */
  private exportToCSV(rows: any[], columns: string[]): { name: string; content: string } {
    // Header
    const header = columns.join(',');

    // Rows
    const rowStrings = rows.map(row => {
      return columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) return `"${value}"`;
        return String(value);
      }).join(',');
    });

    const csv = [header, ...rowStrings].join('\n');

    return {
      name: `query_results_${Date.now()}.csv`,
      content: csv
    };
  }

  /**
   * Export to JSON
   */
  exportToJSON(rows: any[]): { name: string; content: string } {
    const json = JSON.stringify(rows, null, 2);

    return {
      name: `query_results_${Date.now()}.json`,
      content: json
    };
  }

  /**
   * Format for text-only display (no embeds)
   */
  formatPlainText(
    executionResult: ExecutionResult,
    parsedQuery: ParsedQuery,
    question: string
  ): string {
    if (!executionResult.success) {
      return `❌ Query failed: ${executionResult.error}`;
    }

    if (executionResult.rowCount === 0) {
      return '📭 No results found.';
    }

    const rows = executionResult.rows.slice(0, 10);
    const keys = Object.keys(rows[0]);

    let output = `📊 **${question}**\n\n`;

    // Single row summary
    if (rows.length === 1) {
      keys.forEach(key => {
        output += `**${this.formatColumnName(key)}:** ${this.formatValue(rows[0][key])}\n`;
      });
    } else {
      // Multiple rows table
      const table = this.createAsciiTable(rows, keys);
      output += `\`\`\`\n${table}\n\`\`\`\n`;

      if (executionResult.rowCount > 10) {
        output += `\n*Showing 10 of ${executionResult.rowCount} results*`;
      }
    }

    output += `\n\n*Executed in ${executionResult.executionTime}ms${executionResult.cached ? ' (cached)' : ''}*`;

    return output;
  }
}

/**
 * Example usage:
 *
 * const formatter = new ResultFormatter();
 *
 * // Format query result
 * const formatted = formatter.format(executionResult, parsedQuery, 'Bugün kaç ban yedi?');
 *
 * // Send to Discord
 * if (formatted.embed) {
 *   await message.reply({ embeds: [formatted.embed] });
 * }
 *
 * // If file attachment (CSV export)
 * if (formatted.file) {
 *   const attachment = new AttachmentBuilder(
 *     Buffer.from(formatted.file.content),
 *     { name: formatted.file.name }
 *   );
 *   await message.reply({ files: [attachment] });
 * }
 *
 * // Plain text format
 * const plainText = formatter.formatPlainText(executionResult, parsedQuery, question);
 * await message.reply(plainText);
 */
