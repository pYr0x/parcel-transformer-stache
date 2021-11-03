import type {TransformerResult} from '@parcel/types';

import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import {hashObject} from '@parcel/utils';
import ThrowableDiagnostic, {
  Diagnostic,
  escapeMarkdown,
  md,
} from '@parcel/diagnostic';
import SourceMap from '@parcel/source-map';
import semver from 'semver';
import {basename, extname, relative, dirname} from 'path';

// @ts-ignore
import {parse} from "can-stache-ast";
// $FlowFixMe
// import consolidate from 'consolidate';

const MODULE_BY_NAME_RE = /\.module\./;

// TODO: Use language-specific config files during preprocessing
export default (new Transformer({
  // async loadConfig({config}) {
  //   let conf = await config.getConfig(
  //     ['.vuerc', '.vuerc.json', '.vuerc.js', 'vue.config.js'],
  //     {packageKey: 'vue'},
  //   );
  //   let contents = {};
  //   if (conf) {
  //     config.invalidateOnStartup();
  //     contents = conf.contents;
  //     if (typeof contents !== 'object') {
  //       // TODO: codeframe
  //       throw new ThrowableDiagnostic({
  //         diagnostic: {
  //           message: 'Vue config should be an object.',
  //           origin: '@parcel/transformer-vue',
  //         },
  //       });
  //     }
  //   }
  //   return {
  //     customBlocks: contents.customBlocks || {},
  //     filePath: conf && conf.filePath,
  //   };
  // },
  canReuseAST({ast}) {
    return ast.type === 'stache' && semver.satisfies(ast.version, '^0.0.1');
  },
  async parse({asset}) {
    // TODO: This parses the vue component multiple times. Fix?
    let code = await asset.getCode();
    let ast = parse(asset.filePath, code.trim());

    // if (parsed.errors.length) {
    //   throw new ThrowableDiagnostic({
    //     diagnostic: parsed.errors.map(err => {
    //       return createDiagnostic(err, asset.filePath);
    //     }),
    //   });
    // }

    return {
      type: 'stache',
      version: '0.0.1',
      program: ast
    };
  },
  async transform({asset, options, resolve, config}) {
    let id = hashObject({
      filePath: asset.filePath,
    }).slice(-6);
    let ast = await asset.getAST();

    const intermediate = JSON.stringify(ast?.program.intermediate);

    const tagImportMap: string[] = [];
    const simpleImports: string[] = [];

    const staticImports = [...new Set(ast?.program.imports || [])];
    staticImports.forEach((file) => {
      for (let importFile of ast?.program.importDeclarations) {
        if (importFile && importFile.specifier === file && importFile.attributes instanceof Map) {
          if(importFile.attributes.size > 1) {
            tagImportMap.push(importFile.specifier);
            break;
          }else if(importFile.attributes.size === 1){
            simpleImports.push(importFile.specifier);
            break;
          }
        }
      }
    });

    const dynamicImportMap: string[] = ast?.program.dynamicImports || [];

    // let scopeId = 'data-v-' + id;
    // let hmrId = id + '-hmr';
    let basePath = basename(asset.filePath);
    // let {template, script, styles, customBlocks} = nullthrows(
    //   await asset.getAST(),
    // ).program;
    // if (asset.pipeline != null) {
    //   return processPipeline({
    //     asset,
    //     template,
    //     script,
    //     styles,
    //     customBlocks,
    //     config,
    //     basePath,
    //     options,
    //     resolve,
    //     id,
    //     hmrId,
    //   });
    // }
    return [
      {
        type: 'js',
        // uniqueKey: asset.id + '-glue',

        // language=JavaScript
        content: `
          import stache from 'can-stache';
          import Scope from 'can-view-scope';
          import 'can-view-import';
          import 'can-stache/src/mustache_core';
          import stacheBindings from 'can-stache-bindings';
          ${dynamicImportMap.length ? `import importer from 'parcel-stache-import-module';`: ``}

          ${tagImportMap.map((file, i) => `import * as i_${i} from '${file}';`).join('\n')}
          ${simpleImports.map((file) => `import '${file}';`).join('\n')}

          stache.addBindings(stacheBindings);
          var renderer = stache(${intermediate});
          ${dynamicImportMap.length ? `
            const dynamicImportMap = Object.assign({}, ${dynamicImportMap.map((file) => {
            if(!extname(file)){
              file += '.js';
            }
            return `{'${file}': () => import('${file}')}`;
          }).join(",")});
            importer(dynamicImportMap);
          `: ``}
          export default function (scope, options, nodeList) {
            if (!(scope instanceof Scope)) {
              scope = new Scope(scope);
            }
            var variableScope = scope.getScope(function (s) {
              return s._meta.variable === true
            });
            if (!variableScope) {
              scope = scope.addLetContext();
              variableScope = scope;
            }
            var moduleOptions = Object.assign({}, options);
            Object.assign(variableScope._context, {
              module: null,
              tagImportMap: []
            });

            return renderer(scope, moduleOptions, nodeList);
          }`
      },
    ];
  },
}));

// function createDiagnostic(err, filePath) {
//   if (typeof err === 'string') {
//     return {
//       message: err,
//       origin: '@parcel/transformer-vue',
//       filePath,
//     };
//   }
//   // TODO: codeframe
//   let diagnostic: Diagnostic = {
//     message: escapeMarkdown(err.message),
//     origin: '@parcel/transformer-vue',
//     name: err.name,
//     stack: err.stack,
//   };
//   if (err.loc) {
//     diagnostic.codeFrames = [
//       {
//         codeHighlights: [
//           {
//             start: {
//               line: err.loc.start.line + err.loc.start.offset,
//               column: err.loc.start.column,
//             },
//             end: {
//               line: err.loc.end.line + err.loc.end.offset,
//               column: err.loc.end.column,
//             },
//           },
//         ],
//       },
//     ];
//   }
//   return diagnostic;
// }
//
// async function processPipeline({
//                                  asset,
//                                  template,
//                                  script,
//                                  styles,
//                                  customBlocks,
//                                  config,
//                                  basePath,
//                                  options,
//                                  resolve,
//                                  id,
//                                  hmrId,
//                                }) {
//   switch (asset.pipeline) {
//     case 'template': {
//       let isFunctional = template.functional;
//       if (template.src) {
//         template.content = (
//           await options.inputFS.readFile(
//             await resolve(asset.filePath, template.src),
//           )
//         ).toString();
//         template.lang = extname(template.src).slice(1);
//       }
//       let content = template.content;
//       if (template.lang && !['htm', 'html'].includes(template.lang)) {
//         let preprocessor = consolidate[template.lang];
//         if (!preprocessor) {
//           // TODO: codeframe
//           throw new ThrowableDiagnostic({
//             diagnostic: {
//               message: md`Unknown template language: "${template.lang}"`,
//               origin: '@parcel/transformer-vue',
//             },
//           });
//         }
//         content = await preprocessor.render(content, {});
//       }
//       let templateComp = compiler.compileTemplate({
//         filename: asset.filePath,
//         source: content,
//         inMap: template.src ? undefined : template.map,
//         scoped: styles.some(style => style.scoped),
//         isFunctional,
//         id,
//       });
//       if (templateComp.errors.length) {
//         throw new ThrowableDiagnostic({
//           diagnostic: templateComp.errors.map(err => {
//             return createDiagnostic(err, asset.filePath);
//           }),
//         });
//       }
//       let templateAsset: TransformerResult = {
//         type: 'js',
//         uniqueKey: asset.id + '-template',
//         ...(!template.src &&
//           asset.env.sourceMap && {
//             map: createMap(templateComp.map, options.projectRoot),
//           }),
//         content:
//           templateComp.code +
//           `
// ${
//             options.hmrOptions
//               ? `if (module.hot) {
//   module.hot.accept(() => {
//     __VUE_HMR_RUNTIME__.rerender('${hmrId}', render);
//   })
// }`
//               : ''
//           }`,
//       };
//       return [templateAsset];
//     }
//     case 'script': {
//       if (script.src) {
//         script.content = (
//           await options.inputFS.readFile(
//             await resolve(asset.filePath, script.src),
//           )
//         ).toString();
//         script.lang = extname(script.src).slice(1);
//       }
//       let type;
//       switch (script.lang || 'js') {
//         case 'javascript':
//         case 'js':
//           type = 'js';
//           break;
//         case 'jsx':
//           type = 'jsx';
//           break;
//         case 'typescript':
//         case 'ts':
//           type = 'ts';
//           break;
//         case 'tsx':
//           type = 'tsx';
//           break;
//         case 'coffeescript':
//         case 'coffee':
//           type = 'coffee';
//           break;
//         default:
//           // TODO: codeframe
//           throw new ThrowableDiagnostic({
//             diagnostic: {
//               message: md`Unknown script language: "${script.lang}"`,
//               origin: '@parcel/transformer-vue',
//             },
//           });
//       }
//       let scriptAsset = {
//         type,
//         uniqueKey: asset.id + '-script',
//         content: script.content,
//         ...(!script.src &&
//           asset.env.sourceMap && {
//             map: createMap(script.map, options.projectRoot),
//           }),
//       };
//
//       return [scriptAsset];
//     }
//     case 'style': {
//       let cssModules = {};
//       let assets = await Promise.all(
//         styles.map(async (style, i) => {
//           if (style.src) {
//             style.content = (
//               await options.inputFS.readFile(
//                 await resolve(asset.filePath, style.src),
//               )
//             ).toString();
//             if (!style.module) {
//               style.module = MODULE_BY_NAME_RE.test(style.src);
//             }
//             style.lang = extname(style.src).slice(1);
//           }
//           switch (style.lang) {
//             case 'less':
//             case 'stylus':
//             case 'styl':
//             case 'scss':
//             case 'sass':
//             case 'css':
//             case undefined:
//               break;
//             default:
//               // TODO: codeframe
//               throw new ThrowableDiagnostic({
//                 diagnostic: {
//                   message: md`Unknown style language: "${style.lang}"`,
//                   origin: '@parcel/transformer-vue',
//                 },
//               });
//           }
//           let styleComp = await compiler.compileStyleAsync({
//             filename: asset.filePath,
//             source: style.content,
//             modules: style.module,
//             preprocessLang: style.lang || 'css',
//             scoped: style.scoped,
//             map: style.src ? undefined : style.map,
//             id,
//           });
//           if (styleComp.errors.length) {
//             throw new ThrowableDiagnostic({
//               diagnostic: styleComp.errors.map(err => {
//                 return createDiagnostic(err, asset.filePath);
//               }),
//             });
//           }
//           let styleAsset = {
//             type: 'css',
//             content: styleComp.code,
//             sideEffects: true,
//             ...(!style.src &&
//               asset.env.sourceMap && {
//                 map: createMap(style.map, options.projectRoot),
//               }),
//             uniqueKey: asset.id + '-style' + i,
//           };
//           if (styleComp.modules) {
//             if (typeof style.module === 'boolean') style.module = '$style';
//             cssModules[style.module] = {
//               ...cssModules[style.module],
//               ...styleComp.modules,
//             };
//           }
//           return styleAsset;
//         }),
//       );
//       if (Object.keys(cssModules).length !== 0) {
//         assets.push({
//           type: 'js',
//           uniqueKey: asset.id + '-cssModules',
//           content: `
// import {render} from 'template:./${basePath}';
// let cssModules = ${JSON.stringify(cssModules)};
// ${
//             options.hmrOptions
//               ? `if (module.hot) {
//   module.hot.accept(() => {
//     __VUE_HMR_RUNTIME__.rerender('${hmrId}', render);
//   });
// };`
//               : ''
//           }
// export default cssModules;`,
//         });
//       }
//       return assets;
//     }
//     case 'custom': {
//       let toCall = [];
//       // To satisfy flow
//       if (!config) return [];
//       let types = new Set();
//       for (let block of customBlocks) {
//         let {type, src, content, attrs} = block;
//         if (!config.customBlocks[type]) {
//           // TODO: codeframe
//           throw new ThrowableDiagnostic({
//             diagnostic: {
//               message: md`No preprocessor found for block type ${type}`,
//               origin: '@parcel/transformer-vue',
//             },
//           });
//         }
//         if (src) {
//           content = (
//             await options.inputFS.readFile(await resolve(asset.filePath, src))
//           ).toString();
//         }
//         toCall.push([type, content, attrs]);
//         types.add(type);
//       }
//       return [
//         {
//           type: 'js',
//           uniqueKey: asset.id + '-custom',
//           content: `
// let NOOP = () => {};
// ${(
//             await Promise.all(
//               [...types].map(
//                 async type =>
//                   `import p${type} from './${relative(
//                     dirname(asset.filePath),
//                     await resolve(nullthrows(config.filePath), config.customBlocks[type]),
//                   )}';
// if (typeof p${type} !== 'function') {
//   p${type} = NOOP;
// }`,
//               ),
//             )
//           ).join('\n')}
// export default script => {
//   ${toCall
//             .map(
//               ([type, content, attrs]) =>
//                 `  p${type}(script, ${JSON.stringify(content)}, ${JSON.stringify(
//                   attrs,
//                 )});`,
//             )
//             .join('\n')}
// }`,
//         },
//       ];
//     }
//     default: {
//       return [];
//     }
//   }
// }
//
// function createMap(rawMap, projectRoot: string) {
//   let newMap = new SourceMap(projectRoot);
//   newMap.addVLQMap(rawMap);
//   return newMap;
// }
