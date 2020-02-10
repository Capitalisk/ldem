module.exports = function (duration) {
  let timeoutId;
  let promise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve();
    }, duration);
  });
  promise.timeoutId = timeoutId;
  return promise;
};
