import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Tool } from '../models/Tool.js';
import dotenv from 'dotenv';

// Load .env from parent directory (MarketplaceBackend)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const USER_TOOLS_DIR = path.join(__dirname, '../user_tools');

const inferParameters = (code) => {
    // Attempt 1: Look for function({ param1, param2 }) or async function({ ... })
    const destructuredParamsMatch = code.match(/function\s*\(\s*\{\s*([^}]+)\s*\}\s*\)/);
    if (destructuredParamsMatch) {
        return parseDestructured(destructuredParamsMatch[1]);
    }

    // Attempt 2: Look for `const { ... } = args;`
    const argsDestructuringMatch = code.match(/const\s*{\s*([^}]+)\s*}\s*=\s*args/);
    if (argsDestructuringMatch) {
        return parseDestructured(argsDestructuringMatch[1]);
    }

    return { type: "object", properties: {}, required: [] };
};

const parseDestructured = (str) => {
    const properties = {};
    const required = [];

    // Remove comments to clean up parsing (basic)
    str = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '');

    // Split by comma, handling potential defaults like `page = 1`
    const parts = str.split(',').map(p => p.trim()).filter(p => p);

    parts.forEach(part => {
        // Check for default value
        const [key, defaultValue] = part.split('=').map(k => k.trim());
        const paramName = key.split(':')[0].trim(); // Handle aliasing e.g. `a: b` (param is a) - actually for destructuring { a: b } = obj, b is the var... wait.
        // For function({ a }) -> param is a.
        // For const { a } = args -> param is a.
        // For const { a: b } = args -> property is a.

        // Let's assume simple destructuring for now: `param` or `param = val`
        // We want the property name on the incoming object.
        // If `const { a: b } = args`, we want 'a'.

        let propName = paramName;
        // Simple heuristic: if it contains ':', take the first part
        if (paramName.includes(':')) {
            propName = paramName.split(':')[0].trim();
        }

        properties[propName] = {
            type: "string", // Default to string
            description: `Parameter ${propName}`
        };

        if (defaultValue === undefined) {
            required.push(propName);
        } else {
            properties[propName].description += ` (Default: ${defaultValue})`;
        }
    });

    return {
        type: "object",
        properties,
        required
    };
};


const importTools = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI not found in .env");
        }


        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, family: 4 });
        console.log('Connected to MongoDB');

        const files = fs.readdirSync(USER_TOOLS_DIR).filter(file => file.endsWith('.js'));

        for (const file of files) {
            console.log(`Processing ${file}...`);
            const filePath = path.join(USER_TOOLS_DIR, file);
            const code = fs.readFileSync(filePath, 'utf-8');
            const name = parseToolName(file);

            // Skip test files or partials if needed, but for now import all
            if (name.includes('test') && !name.includes('final')) {
                // optional: skip tests
            }

            const parameters = inferParameters(code);
            const description = `Tool imported from ${file}. Takes arguments: ${Object.keys(parameters.properties).join(', ')}`;


            // Create or update tool
            await Tool.findOneAndUpdate(
                { name },
                {
                    name,
                    description,
                    price: "0.01", // Default small price
                    parameters,
                    type: 'code',
                    code,
                    walletAddress: "0x03FffAa8a56f3faF2829883c2aA62B8Bf89b9E5f",
                    trusted: true,
                    status: 'approved'
                },
                { upsert: true, new: true }
            );
            console.log(`Imported tool: ${name}`);
        }

        console.log('All tools imported successfully.');
        process.exit(0);

    } catch (error) {
        console.error('Error importing tools:', error);
        process.exit(1);
    }
};

const parseToolName = (filename) => {
    return filename.replace('.js', '');
};

importTools();
