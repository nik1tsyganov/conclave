const fs = require('fs');

function parseArgs(argv) {
  const args = {
    from: 'cursor',
    errorText: '',
    errorFile: '',
    force: '',
    capacityState: '',
    json: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    
    if (['--from', '--error-text', '--error-file', '--force', '--capacity-state'].includes(arg)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        console.error(`not a pass: missing value for ${arg}`);
        process.exit(2);
      }
      const val = argv[++i];
      if (arg === '--from') args.from = val;
      else if (arg === '--error-text') args.errorText = val;
      else if (arg === '--error-file') args.errorFile = val;
      else if (arg === '--force') args.force = val;
      else if (arg === '--capacity-state') args.capacityState = val;
      continue;
    }

    console.error(`not a pass: unknown flag ${arg}`);
    process.exit(2);
  }

  if (!['cursor', 'cursor-cli', 'synara'].includes(args.from)) {
    console.error(`not a pass: invalid --from ${args.from}`);
    process.exit(2);
  }

  if (args.force && !['cursor-cli', 'synara'].includes(args.force)) {
    console.error(`not a pass: invalid --force ${args.force}`);
    process.exit(2);
  }

  return args;
}

function checkCapacityState(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data && Array.isArray(data.buckets)) {
    for (const bucket of data.buckets) {
      const bucketId = bucket.id || bucket.bucketId;
      if (['cursor', 'cursorTask', 'hostMode:cursor'].includes(bucketId) && bucket.status === 'exhausted') {
        return true;
      }
    }
  }

  return false;
}

function main() {
  const args = parseArgs(process.argv);

  let errorContent = args.errorText || '';

  if (args.errorFile) {
    try {
      errorContent = fs.readFileSync(args.errorFile, 'utf8');
    } catch (e) {
      console.error('not a pass: unreadable --error-file');
      process.exit(2);
    }
  }

  if (args.force === 'cursor-cli' || args.force === 'synara') {
    return { hostMode: args.force, tripped: true, reason: 'forced', isJson: args.json };
  }

  if (args.from === 'cursor-cli') {
    return { hostMode: 'cursor-cli', tripped: false, reason: 'already-cli', isJson: args.json };
  }

  if (args.from === 'synara') {
    return { hostMode: 'synara', tripped: false, reason: 'already-synara', isJson: args.json };
  }

  if (args.capacityState) {
    if (checkCapacityState(args.capacityState)) {
      return { hostMode: 'cursor-cli', tripped: true, reason: 'capacity-exhausted', isJson: args.json };
    }
  }

  if (errorContent) {
    const lowerError = errorContent.toLowerCase();
    const triggers = [
      'usage limit',
      'rate limit',
      'quota',
      'resource_exhausted',
      'weekly limit',
      'out of usage'
    ];
    for (const trigger of triggers) {
      if (lowerError.includes(trigger)) {
        return { hostMode: 'cursor-cli', tripped: true, reason: 'cursor-usage-exhausted', isJson: args.json };
      }
    }
  }

  return { hostMode: 'cursor', tripped: false, reason: 'ok', isJson: args.json };
}

try {
  const result = main();
  const isJson = result.isJson;
  delete result.isJson;
  
  if (isJson) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`hostMode: ${result.hostMode}`);
    console.log(`tripped: ${result.tripped}`);
    console.log(`reason: ${result.reason}`);
  }
  process.exit(0);
} catch (e) {
  console.error('not a pass', e.message);
  process.exit(2);
}
