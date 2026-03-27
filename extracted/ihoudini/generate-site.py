"""추출된 블로그 데이터로 정적 사이트 생성"""
import json
import os
import re
from datetime import datetime

SITE_DIR = os.path.join(os.path.dirname(__file__), 'site')
DATA_FILE = os.path.join(os.path.dirname(__file__), 'blog-data.json')
IMAGE_MAP_FILE = os.path.join(os.path.dirname(__file__), 'image-map.json')

with open(DATA_FILE, encoding='utf-8') as f:
    data = json.load(f)

with open(IMAGE_MAP_FILE, encoding='utf-8') as f:
    image_map = json.load(f)

meta = data['meta']
posts = data['posts']

def slugify(title):
    slug = re.sub(r'[^a-zA-Z0-9\s-]', '', title.lower())
    return re.sub(r'[\s]+', '-', slug.strip())[:60]

def format_date(iso_str):
    dt = datetime.fromisoformat(iso_str)
    return dt.strftime('%B %d, %Y')

def localize_images(html):
    """원격 이미지 URL을 로컬 경로로 교체"""
    for url, local_name in image_map.items():
        html = html.replace(url, f'../images/{local_name}')
    return html

# 공통 CSS
SITE_CSS = """
:root {
  --bg: #f5f5f0;
  --text: #333;
  --accent: #8b7355;
  --card-bg: #fff;
  --border: #e0ddd5;
  --font-heading: 'EB Garamond', Georgia, serif;
  --font-body: 'Lato', -apple-system, sans-serif;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text);
  line-height: 1.7;
  font-size: 16px;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 20px;
}

/* Header */
.site-header {
  background: #8b7355;
  color: #fff;
  padding: 40px 0;
  text-align: center;
}

.site-title {
  font-family: var(--font-heading);
  font-size: 2.5em;
  font-weight: 400;
  margin-bottom: 8px;
}

.site-subtitle {
  font-size: 14px;
  opacity: 0.85;
  max-width: 600px;
  margin: 0 auto;
  line-height: 1.5;
}

/* Navigation */
nav {
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
  position: sticky;
  top: 0;
  z-index: 100;
}

nav .container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

nav a {
  color: var(--accent);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.categories {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cat-tag {
  font-size: 11px;
  background: #f0ede5;
  color: #8b7355;
  padding: 2px 8px;
  border-radius: 3px;
  text-decoration: none;
}

/* Post cards */
.post-list {
  padding: 30px 0;
}

.post-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 24px;
  overflow: hidden;
  transition: box-shadow 0.2s;
}

.post-card:hover {
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

.post-card-image {
  width: 100%;
  height: 250px;
  object-fit: cover;
  display: block;
}

.post-card-body {
  padding: 24px;
}

.post-card-date {
  font-size: 12px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.post-card-title {
  font-family: var(--font-heading);
  font-size: 1.5em;
  margin: 8px 0;
}

.post-card-title a {
  color: var(--text);
  text-decoration: none;
}

.post-card-title a:hover {
  color: var(--accent);
}

.post-card-excerpt {
  color: #666;
  font-size: 14px;
  line-height: 1.6;
}

.post-card-meta {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}

.post-card-label {
  font-size: 11px;
  background: #f0ede5;
  color: #8b7355;
  padding: 2px 8px;
  border-radius: 3px;
}

/* Single post */
.post-header {
  padding: 40px 0 20px;
}

.post-title {
  font-family: var(--font-heading);
  font-size: 2.2em;
  font-weight: 400;
  margin-bottom: 8px;
}

.post-date {
  color: #999;
  font-size: 14px;
}

.post-content {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 32px;
  margin-bottom: 40px;
}

.post-content img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 16px 0;
}

.post-content iframe {
  max-width: 100%;
  margin: 16px 0;
}

.post-content a {
  color: var(--accent);
}

.post-labels {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

/* Back link */
.back-link {
  display: inline-block;
  margin-bottom: 20px;
  color: var(--accent);
  text-decoration: none;
  font-size: 14px;
}

/* Footer */
.site-footer {
  text-align: center;
  padding: 30px 0;
  font-size: 12px;
  color: #999;
  border-top: 1px solid var(--border);
}

/* Responsive */
@media (max-width: 600px) {
  .site-title { font-size: 1.8em; }
  .post-title { font-size: 1.6em; }
  .post-content { padding: 20px; }
  .post-card-image { height: 180px; }
}
"""

def strip_tags(html):
    return re.sub(r'<[^>]+>', '', html)[:300] + '...'

def get_first_image(post):
    if post['images']:
        url = post['images'][0]
        local = image_map.get(url, '')
        if local:
            return f'images/{local}'
    return ''

# index.html 생성
def generate_index():
    post_cards = ''
    for i, post in enumerate(posts):
        slug = slugify(post['title'])
        date = format_date(post['published'])
        excerpt = strip_tags(post['content'])
        img = get_first_image(post)
        img_html = f'<img class="post-card-image" src="{img}" alt="{post["title"]}" loading="lazy">' if img else ''
        labels = ''.join(f'<span class="post-card-label">{l}</span>' for l in post['labels'][:3])

        post_cards += f'''
    <article class="post-card">
      {img_html}
      <div class="post-card-body">
        <div class="post-card-date">{date}</div>
        <h2 class="post-card-title"><a href="posts/{slug}.html">{post['title']}</a></h2>
        <p class="post-card-excerpt">{excerpt}</p>
        <div class="post-card-meta">{labels}</div>
      </div>
    </article>'''

    all_labels = sorted(set(l for p in posts for l in p['labels']))
    cat_tags = ''.join(f'<span class="cat-tag">{l}</span>' for l in all_labels[:15])

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{meta['title']}</title>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600&family=Lato:wght@400;700&display=swap" rel="stylesheet">
  <style>{SITE_CSS}</style>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <h1 class="site-title">{meta['title']}</h1>
      <p class="site-subtitle">{meta['subtitle']}</p>
    </div>
  </header>

  <nav>
    <div class="container">
      <a href="index.html">{meta['title']}</a>
      <div class="categories">{cat_tags}</div>
    </div>
  </nav>

  <main class="container post-list">
    {post_cards}
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>Recreated from {meta['title']} | {meta['totalPosts']} posts | Generated by ScrapeFlow</p>
    </div>
  </footer>
</body>
</html>'''

    with open(os.path.join(SITE_DIR, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(html)

# 개별 포스트 페이지 생성
def generate_posts():
    for i, post in enumerate(posts):
        slug = slugify(post['title'])
        date = format_date(post['published'])
        content = localize_images(post['content'])
        labels = ''.join(f'<span class="post-card-label">{l}</span>' for l in post['labels'])

        # 이전/다음 포스트 링크
        prev_link = ''
        next_link = ''
        if i > 0:
            prev_slug = slugify(posts[i-1]['title'])
            prev_link = f'<a href="{prev_slug}.html">&larr; {posts[i-1]["title"]}</a>'
        if i < len(posts) - 1:
            next_slug = slugify(posts[i+1]['title'])
            next_link = f'<a href="{next_slug}.html">{posts[i+1]["title"]} &rarr;</a>'

        html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{post['title']} - {meta['title']}</title>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600&family=Lato:wght@400;700&display=swap" rel="stylesheet">
  <style>{SITE_CSS}</style>
</head>
<body>
  <nav>
    <div class="container">
      <a href="../index.html">{meta['title']}</a>
    </div>
  </nav>

  <main class="container">
    <a href="../index.html" class="back-link">&larr; All Posts</a>

    <header class="post-header">
      <h1 class="post-title">{post['title']}</h1>
      <div class="post-date">{date} &middot; {post['author']}</div>
    </header>

    <article class="post-content">
      {content}
      <div class="post-labels">{labels}</div>
    </article>

    <div style="display:flex;justify-content:space-between;padding:20px 0;font-size:14px;">
      <div>{prev_link}</div>
      <div>{next_link}</div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>Generated by ScrapeFlow</p>
    </div>
  </footer>
</body>
</html>'''

        filepath = os.path.join(SITE_DIR, 'posts', f'{slug}.html')
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html)

generate_index()
generate_posts()

print(f'Site generated: {SITE_DIR}')
print(f'  index.html + {len(posts)} post pages')
print(f'  {len(os.listdir(os.path.join(SITE_DIR, "images")))} images')
