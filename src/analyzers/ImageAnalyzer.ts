// ImageAnalyzer.ts - Vision AI for image and meme analysis

import { OllamaService } from '../services/OllamaService';
import axios from 'axios';

export interface ImageAnalysis {
  isInappropriate: boolean;
  confidence: number;
  categories: string[];
  reasoning: string;
  extractedText?: string;
  containsScamIndicators: boolean;
}

export class ImageAnalyzer {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('vision');
  }

  /**
   * Analyze image for inappropriate content
   */
  async analyzeImage(imageUrl: string): Promise<ImageAnalysis> {
    console.log(`🖼️ Analyzing image: ${imageUrl}`);

    try {
      // Download image data
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });

      const imageBase64 = Buffer.from(response.data, 'binary').toString('base64');

      // Use vision-capable AI model (llava or similar)
      const prompt = `Analyze this image for inappropriate content:

Check for:
1. NSFW/sexual content
2. Violence or gore
3. Hate symbols (swastikas, confederate flags, etc.)
4. Scam indicators (fake giveaways, QR codes, phishing links)
5. Text content (OCR)
6. Offensive memes or imagery

Respond with:
- isInappropriate: boolean
- confidence: 0-1
- categories: array of categories detected (nsfw, violence, hate, scam, offensive)
- reasoning: why you flagged it or why it's safe
- extractedText: any text found in the image
- containsScamIndicators: boolean`;

      const systemPrompt = `You are a vision AI specialized in content moderation. Be thorough and accurate.`;

      const schema = `{
  "isInappropriate": boolean,
  "confidence": number,
  "categories": string[],
  "reasoning": string,
  "extractedText": string,
  "containsScamIndicators": boolean
}`;

      // Note: This requires a vision-capable model like llava
      // You may need to implement vision API integration
      const result = await this.ollama.generateJSONWithImage<ImageAnalysis>(
        prompt,
        systemPrompt,
        imageBase64,
        schema
      );

      console.log(`   Result: ${result.isInappropriate ? '🚫 INAPPROPRIATE' : '✅ SAFE'} (${(result.confidence * 100).toFixed(0)}%)`);
      if (result.categories.length > 0) {
        console.log(`   Categories: ${result.categories.join(', ')}`);
      }
      if (result.extractedText) {
        console.log(`   Text: "${result.extractedText}"`);
      }

      return result;
    } catch (error) {
      console.error('Image analysis failed:', error);
      return {
        isInappropriate: false,
        confidence: 0,
        categories: [],
        reasoning: 'Analysis failed - defaulting to safe',
        containsScamIndicators: false,
      };
    }
  }

  /**
   * Quick check if image URL looks suspicious
   */
  isSuspiciousUrl(url: string): boolean {
    const suspiciousPatterns = [
      /bit\.ly/i,
      /tinyurl/i,
      /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i, // Raw IP
      /scam|phishing|malware/i,
    ];

    return suspiciousPatterns.some(pattern => pattern.test(url));
  }
}
