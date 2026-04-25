const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: './src/ui/index.js',
  target: 'web',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'renderer.js',
    publicPath: './', // Relative path agar kompatibel dengan file:// protocol di production
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', ['@babel/preset-react', {"runtime": "automatic"}]]
          }
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|webp|svg)$/i,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    fallback: {
      fs: false,
      crypto: false,
      path: false,
      os: false,
    }
  },
  ignoreWarnings: [
    {
      module: /@vladmandic\/face-api/,
      message: /Critical dependency/
    }
  ],
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/ui/index.html',
    }),
  ],
  devServer: {
    client: {
      logging: 'error', // Menyembunyikan log client kecuali error
    },
    devMiddleware: {
      stats: 'errors-only', // Menyembunyikan log wait until bundle finished
    },
    static: [
      {
        directory: path.join(__dirname, 'dist'),
      },
      {
        directory: path.join(__dirname, 'public'),
      }
    ],
    port: 3002,
    historyApiFallback: true, // Added for React Router
  },
};