/*
 * 独立预览构建配置(非 Module Federation)
 * 用 `npm run preview` 启动本地 dev server，无需 FatNotes 宿主即可查看完整编辑器
 */
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  mode: "development",
  entry: "./src/preview.tsx",
  output: {
    path: path.resolve(__dirname, "dist-preview"),
    filename: "preview.[contenthash:8].js",
    publicPath: "/",
    clean: true,
  },
  devServer: {
    static: { directory: path.resolve(__dirname, "dist-preview") },
    port: 5200,
    hot: true,
    open: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: {
      components: path.resolve(__dirname, "src/components/index"),
      enums: path.resolve(__dirname, "src/enums/index"),
      hooks: path.resolve(__dirname, "src/hooks/index"),
      reducers: path.resolve(__dirname, "src/reducers/index"),
      utils: path.resolve(__dirname, "src/utils/index"),
      contexts: path.resolve(__dirname, "src/contexts/index"),
      store: path.resolve(__dirname, "src/store/index"),
    },
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: { loader: "ts-loader", options: { transpileOnly: true } },
        exclude: /node_modules/,
      },
      {
        test: /\.(css|less)$/,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              modules: {
                auto: (resourcePath) => resourcePath.endsWith(".less"),
                namedExport: false,
                localIdentName: "[local]_[hash:base64:5]",
              },
            },
          },
          "less-loader",
        ],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: "asset/resource",
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "./public/preview.html" }),
  ],
  devtool: "source-map",
};
