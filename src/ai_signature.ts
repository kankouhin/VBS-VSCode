"use strict";
import {
  languages,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  MarkdownString,
  workspace,
  TextDocument,
  Position,
} from 'vscode';
import fs from 'fs';
import path from 'path';
import defaultSigs from './vbs.json';
import UTILS from './util';
import PATTERNS from './patterns';


/**
 * Reduces a partial line of code to the current Function for parsing
 * @param {string} code The line of code
 */
function getParsableCode(code : string) : string {
  const reducedCode = code
    .replace(/\w+\([^()]*\)/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/"[^"]*(?=$)/g, '') // Remove double quote and text at end of line
    .replace(/\([^()]*\)/g, '') // Remove paren sets
    .replace(/\({2,}/g, '('); // Reduce multiple open parens

  return reducedCode;
}

function getCurrentFunction(code : string) {
  const parenSplit = code.split('(');
  // Get the 2nd to last item (right in front of last open paren)
  // and clean up the results
  return parenSplit[parenSplit.length - 2].match(/(.*)\b(\w+)/)[2];
}

function countCommas(code : string) {
  // Find the position of the closest/last open paren
  const openParen = code.lastIndexOf('(');
  // Count non-string commas in text following open paren
  let commas = code.slice(openParen).match(/(?!\B["'][^"']*),(?![^"']*['"]\B)/g);
  if (commas === null) {
    return 0;
  } else {
    return commas.length;
  }
}

function getCallInfo(doc : TextDocument, pos : Position) {
  // Acquire the text up the point where the current cursor/paren/comma is at
  const codeAtPosition = doc.lineAt(pos.line).text.substring(0, pos.character);
  const cleanCode = getParsableCode(codeAtPosition);

  return {
    func: getCurrentFunction(cleanCode),
    commas: countCommas(cleanCode),
  };
}

function getParams(paramText : string) {
  let params = {};

  if (paramText) {
    paramText.split(',').forEach(param => {
      params = {
        ...params,
        [param]: {
          label: param.trim(),
          documentation: '',
        },
      };
    });
  }

  return params;
}

function getIncludeData(fileName : string, doc : TextDocument) {
  // console.log(fileName)
  
  const functions = {};
  const filePath = UTILS.getIncludePath(fileName, doc);

  let pattern = null;
  const fileData = UTILS.getIncludeText(filePath);
  do {
    pattern = PATTERNS.FUNCTION_SIG.exec(fileData);
    if (pattern) {
      functions[pattern[3]] = {
        label: pattern[1],
        documentation: `Function from ${fileName}`,
        params: getParams(pattern[4]),
      };
    }
  } while (pattern);

  return functions;
}

function findFilepath(file : string) : string {
  const { includePaths } = workspace.getConfiguration('vbs');
  let newPath : string;

  for (let i = 0; i < includePaths.length; i += 1) {
    newPath = path.normalize(`${includePaths[i]}\\`) + file;
    if (fs.existsSync(newPath)) {
      return newPath;
    }
  }

  return null;
}

function getLocalSigs(doc : TextDocument) {
  const text = doc.getText();
  let functions = {};

  let pattern = null;
  do {
    pattern = PATTERNS.FUNCTION_SIG.exec(text);
    if (pattern) {
      functions = {
        ...functions,
        [pattern[3]]: {
          label: pattern[2],
          documentation: 'Local1 Function',
          params: getParams(pattern[4]),
        },
      };
    }
  } while (pattern);

  return functions;
}

module.exports = languages.registerSignatureHelpProvider(
  UTILS.VBS_MODE,
  {
    provideSignatureHelp(document, position) {
      // Find out what called for sig
      const caller = getCallInfo(document, position);
      if (caller == null) {
        return null;
      }

      // Integrate user functions
      const signatures : {} = Object.assign(
        {},
        defaultSigs,
        getLocalSigs(document),
      );

      // Get the called word from the json files
      const foundSig = signatures[caller.func];
      if (foundSig == null) {
        return null;
      }

      const thisSignature = new SignatureInformation(
        foundSig.label,
        new MarkdownString(`##### ${foundSig.documentation}`),
      );
      // Enter parameter information into signature information
      thisSignature.parameters = Object.keys(foundSig.params).map(key => {
        return new ParameterInformation(
          foundSig.params[key].label,
          new MarkdownString(foundSig.params[key].documentation),
        );
      });

      // Place signature information into results
      const result = new SignatureHelp();
      result.signatures = [thisSignature];
      result.activeSignature = 0;
      result.activeParameter = caller.commas;

      return result;
    },
  },
  '(',
  ',',
);
