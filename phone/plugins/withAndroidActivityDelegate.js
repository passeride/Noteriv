const { withMainActivity } = require('expo/config-plugins');

// React Native 0.88 keeps the former Fabric flag constructor as a deprecated
// overload. It ignores the flag, so the two-argument delegate is equivalent.
module.exports = function withAndroidActivityDelegate(config) {
  return withMainActivity(config, activity => {
    if (activity.modResults.language !== 'kt') return activity;
    activity.modResults.contents = activity.modResults.contents
      .replace(/^[ \t]*import com\.facebook\.react\.defaults\.DefaultNewArchitectureEntryPoint\.fabricEnabled\r?\n/m, '')
      .replace(/(DefaultReactActivityDelegate\(\s*this,\s*mainComponentName),\s*fabricEnabled\s*(\))/g, '$1$2');
    return activity;
  });
};
