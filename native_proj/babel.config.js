module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 58) automatically configures react-native-worklets/plugin
    // for react-native-reanimated v4; adding react-native-reanimated/plugin again duplicates transforms.
    presets: ['babel-preset-expo'],
  };
};
