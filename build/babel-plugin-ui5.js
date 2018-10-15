const Path = require("path");

exports.default = (ui5NameSpace = "") => function ({ types: t }) {
  const ui5ModuleVisitor = {
    Program: {
      enter: path => {
        const filePath = Path.resolve(path.hub.file.opts.filename);

        const sourceRootPath = getSourceRoot(path);

        let relativeFilePath = null;
        let relativeFilePathWithoutExtension = null;
        if (filePath.startsWith(sourceRootPath)) {
          relativeFilePath = Path.relative(sourceRootPath, filePath);
          relativeFilePathWithoutExtension = Path.dirname(relativeFilePath) + Path.sep + Path.basename(relativeFilePath, Path.extname(relativeFilePath));
          relativeFilePathWithoutExtension = relativeFilePathWithoutExtension.replace(/\\/g, "/");

        }

        if (!path.state) {
          path.state = {};
        }
        path.state.ui5 = {
          filePath,
          relativeFilePath,
          relativeFilePathWithoutExtension,
          namespace: ui5NameSpace,
          namePath: ui5NameSpace.replace(/\./g, "\/"),
          className: null,
          fullClassName: null,
          superClassName: null,
          imports: [],
          staticMembers: []
        };
      }
    },

    ImportDeclaration: path => {
      const state = path.state.ui5;
      const node = path.node;
      let name = null;
      var localFile = false;

      let src = node.source.value;
      if (src.startsWith("./") || src.startsWith("../") || !src.startsWith("sap")) {
        try {
          const sourceRootPath = getSourceRoot(path);
          src = Path.relative(sourceRootPath, Path.resolve(Path.dirname(path.hub.file.opts.filename), src));
          localFile = true;
        } catch (e) {
          localFile = false;
        }
      }
      if (localFile) {
        src = Path.normalize(`${state.namePath}/${src}`);
      } else {
        src = Path.normalize(src);
      }

      if (node.specifiers && node.specifiers.length === 1) {
        name = node.specifiers[0].local.name;
      } else {
        const parts = src.split(Path.sep);
        name = parts[parts.length - 1];
      }

      if (node.leadingComments) {
        state.leadingComments = node.leadingComments;
      }

      const imp = {
        name,
        src: src.replace(/\\/g, "/")
      };
      state.imports.push(imp);

      path.remove();
    },

    ExportDeclaration: path => {
      const state = path.state.ui5;
      const program = path.hub.file.ast.program;

      const defineCallArgs = [
        t.stringLiteral(Path.normalize(state.namePath + "/" + state.relativeFilePathWithoutExtension).replace(/\\/g, "\/")),
        t.arrayExpression(state.imports.map(i => t.stringLiteral(i.src))),
        t.functionExpression(null, state.imports.map(i => t.identifier(i.name)), t.blockStatement([
          t.expressionStatement(t.stringLiteral("use strict")),
          t.returnStatement(transformClass(path.node.declaration, program, state))
        ]))
      ];
      const defineCall = t.callExpression(t.identifier("sap.ui.define"), defineCallArgs);
      if (state.leadingComments) {
        defineCall.leadingComments = state.leadingComments;
      }
      path.replaceWith(defineCall);

      // Add static members
      for (let key in state.staticMembers) {
        const id = t.identifier(state.fullClassName + "." + key);
        const statement = t.expressionStatement(t.assignmentExpression("=", id, state.staticMembers[key]));
        path.insertAfter(statement);
      }
    },

    CallExpression(path) {
      const state = path.state.ui5;
      const node = path.node;

      if (node.callee.type === "Super") {
        if (!state.superClassName) {
          this.errorWithNode("The keyword 'super' can only used in a derrived class.");
        }

        const identifier = t.identifier(state.superClassName + ".apply");
        let args = t.arrayExpression(node.arguments);
        if (node.arguments.length === 1 && node.arguments[0].type === "Identifier" && node.arguments[0].name === "arguments") {
          args = t.identifier("arguments");
        }
        path.replaceWith(
          t.callExpression(identifier, [
            t.identifier("this"),
            args
          ])
        );
      } else if (node.callee.object && node.callee.object.type === "Super") {
        if (!state.superClassName) {
          this.errorWithNode("The keyword 'super' can only used in a derrived class.");
        }

        const identifier = t.identifier(state.superClassName + ".prototype" + "." + node.callee.property.name + ".apply");
        path.replaceWith(
          t.callExpression(identifier, [
            t.identifier("this"),
            t.arrayExpression(node.arguments)
          ])
        );
      }
    }
  };



  function transformClass(node, program, state) {
    if (node.type !== "ClassDeclaration") {
      return node;
    } else {
      resolveClass(node, state);

      const props = [];
      node.body.body.forEach(member => {
        if (member.type === "ClassMethod") {
          const func = t.functionExpression(null, member.params, member.body);
          if (!member.static) {
            func.generator = member.generator;
            func.async = member.async;
            props.push(t.objectProperty(member.key, func));
          } else {
            func.body.body.unshift(t.expressionStatement(t.stringLiteral("use strict")));
            state.staticMembers[member.key.name] = func;
          }
        } else if (member.type == "ClassProperty") {
          if (!member.static) {
            props.push(t.objectProperty(member.key, member.value));
          } else {
            state.staticMembers[member.key.name] = member.value;
          }
        }
      });

      const bodyJSON = t.objectExpression(props);
      const extendCallArgs = [
        t.stringLiteral(state.fullClassName),
        bodyJSON
      ];
      const extendCall = t.callExpression(t.identifier(state.superClassName + ".extend"), extendCallArgs);
      return extendCall;
    }
  }

  function resolveClass(node, state) {
    state.className = node.id.name;
    state.superClassName = node.superClass.name;
    if (state.namespace) {
      state.fullClassName = state.namespace + "." + state.className;
    } else {
      state.fullClassName = state.className;
    }
  }



  function getSourceRoot(path) {
    let sourceRootPath = null;
    if (path.hub.file.opts.sourceRoot) {
      sourceRootPath = Path.resolve(path.hub.file.opts.sourceRoot);
    } else {
      sourceRootPath = Path.resolve("." + Path.sep);
    }
    return sourceRootPath;
  }


  return {
    visitor: ui5ModuleVisitor
  };
};

module.exports = exports.default;