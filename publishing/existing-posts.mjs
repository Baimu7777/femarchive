// Explicit administrator-reviewed legacy file. This never grants arbitrary
// browser-supplied paths; the first read must match the reviewed Git blob.
export const existingPosts = {
  '1ac5d0b7-46a2-407b-915b-cf9939f9211c': {
    path: 'content/posts/35字词整理.md',
    revision: '748eff6c1d7bd408a88b8fe6bfb702cddbcf40f3',
    title: '字词整理',
  },
};

export const validExistingPostPath = value => typeof value === 'string'
  && /^content\/posts\/[^/\\\u0000-\u001f\u007f?#%]{1,150}\.md$/u.test(value)
  && !value.includes('..');
